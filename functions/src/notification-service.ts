import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { Request, Response } from "express";
import {
  AdminAuthError,
  verifyAdminAuthorizationHeader,
} from "./handlers/auth/admin";

type MessageWithoutToken = Omit<admin.messaging.TokenMessage, "token">;

/**
 * プッシュ通知を送信するCloud Function
 *
 * リクエストボディの形式:
 * {
 *   "token": "FCMトークン",
 *   "notification": {
 *     "title": "通知タイトル",
 *     "body": "通知本文"
 *   },
 *   "data": {
 *     "type": "通知タイプ",
 *     ... その他の必要なデータ
 *   }
 * }
 */
export const sendNotification = onRequest({
  region: "asia-northeast1",
  cors: true
}, async (req: Request, res: Response) => {
  try {
    // リクエストは必ずPOSTでなければならない
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      await verifyAdminAuthorizationHeader(req.headers.authorization);
    } catch (error) {
      if (error instanceof AdminAuthError) {
        res.status(error.status).send(error.response);
        return;
      }
      throw error;
    }

    const payload = req.body;

    // パラメータのバリデーション
    if (!payload.token || !payload.notification || !payload.data) {
      console.error("必須パラメータが不足しています:", payload);
      res.status(400).send("必須パラメータ（token, notification, data）が不足しています");
      return;
    }

    // 通知タイプに基づいた処理
    const type = payload.data.type;

    // 通知データが正しいか追加のバリデーション
    if (type === "friend_request" && (!payload.data.fromUserId || !payload.data.toUserId)) {
      console.error("友達申請通知に必要なパラメータが不足しています:", payload.data);
      res.status(400).send("友達申請通知に必要なパラメータが不足しています");
      return;
    }

    if (type === "group_invitation" && (!payload.data.groupId || !payload.data.fromUserId)) {
      console.error("グループ招待通知に必要なパラメータが不足しています:", payload.data);
      res.status(400).send("グループ招待通知に必要なパラメータが不足しています");
      return;
    }

    if (type === "reaction" && (!payload.data.fromUserId || !payload.data.scheduleId || !payload.data.interactionId)) {
      console.error("リアクション通知に必要なパラメータが不足しています:", payload.data);
      res.status(400).send("リアクション通知に必要なパラメータが不足しています");
      return;
    }

    if (type === "comment" && (!payload.data.fromUserId || !payload.data.scheduleId || !payload.data.interactionId)) {
      console.error("コメント通知に必要なパラメータが不足しています:", payload.data);
      res.status(400).send("コメント通知に必要なパラメータが不足しています");
      return;
    }

    // FCM通知の送信
    const message: admin.messaging.Message = {
      token: payload.token,
      notification: {
        title: payload.notification.title,
        body: payload.notification.body,
      },
      data: payload.data,
      android: {
        notification: {
          icon: "notification_icon",
          color: "#ffa600",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    console.log("送信する通知:", message);

    const response = await admin.messaging().send(message);
    console.log("通知送信成功:", response);

    res.status(200).send({ success: true, messageId: response });
  } catch (error) {
    console.error("通知送信エラー:", error);
    res.status(500).send({
      error: error instanceof Error ? error.message : "Unknown error",
      code: getErrorCode(error)
    });
  }
});

function getErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "unknown_error";
}

export function isExampleEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith("@example.com");
}

async function shouldAutoAcceptFriendRequest(receiveUserId: string): Promise<boolean> {
  try {
    const userRecord = await admin.auth().getUser(receiveUserId);
    return isExampleEmail(userRecord.email);
  } catch (error) {
    console.error("友達申請の自動承認判定に失敗しました:", error);
    return false;
  }
}

async function acceptFriendRequestAutomatically(
  notificationRef: admin.firestore.DocumentReference
) {
  await notificationRef.update({
    status: "accepted",
    isRead: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getRecipientFcmTokens(
  receiveUserId: string,
  logContext: string
): Promise<string[]> {
  const userDoc = await admin.firestore()
    .collection("users")
    .doc(receiveUserId)
    .get();

  if (!userDoc.exists) {
    console.error(`${logContext}: 受信者が存在しません:`, receiveUserId);
    return [];
  }

  const userData = userDoc.data();
  if (!userData) {
    console.error(`${logContext}: 受信者データが空です:`, receiveUserId);
    return [];
  }

  const rawTokens = userData.fcmTokens;
  if (!Array.isArray(rawTokens)) {
    console.log(`${logContext}: 受信者のFCMトークン配列がありません:`, receiveUserId);
    return [];
  }

  const tokens = [...new Set(
    rawTokens.filter((token): token is string => typeof token === "string" && token.length > 0)
  )];

  if (tokens.length === 0) {
    console.log(`${logContext}: 受信者のFCMトークンがありません:`, receiveUserId);
  }

  return tokens;
}

async function sendToFcmTokens(
  tokens: string[],
  message: MessageWithoutToken,
  logContext: string
): Promise<void> {
  if (tokens.length === 0) {
    return;
  }

  const messages: admin.messaging.Message[] = tokens.map((token) => ({
    ...message,
    token,
  }));
  const response = await admin.messaging().sendEach(messages);

  response.responses.forEach((sendResponse, index) => {
    if (!sendResponse.success) {
      console.error(
        `${logContext}送信失敗: ${maskFcmToken(tokens[index])}`,
        sendResponse.error
      );
    }
  });

  console.log(
    `${logContext}送信結果: success=${response.successCount}, failure=${response.failureCount}`
  );
}

function maskFcmToken(token: string): string {
  return token.length <= 20 ? token : `${token.substring(0, 20)}...`;
}

export const onNotificationCreated = onDocumentCreated({
  region: "asia-northeast1",
  document: "notifications/{notificationId}"
}, async (event) => {
  try {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("データが存在しません");
      return;
    }

    const notification = snapshot.data();

    switch (notification.type) {
    case "friend":
      await handleFriendRequestNotification(
        event.params.notificationId,
        notification,
        snapshot.ref
      );
      return;
    case "groupInvitation":
      await sendGroupInvitationNotification(
        event.params.notificationId,
        notification
      );
      return;
    case "reaction":
      await sendReactionNotification(event.params.notificationId, notification);
      return;
    case "comment":
      await sendCommentNotification(event.params.notificationId, notification);
      return;
    default:
      return;
    }
  } catch (error) {
    console.error("通知作成トリガーエラー:", error);
  }
});

async function handleFriendRequestNotification(
  notificationId: string,
  notification: admin.firestore.DocumentData,
  notificationRef: admin.firestore.DocumentReference
): Promise<void> {
  if (notification.status !== "pending") {
    console.log("保留中ではない友達申請のため、処理をスキップします");
    return;
  }

  if (await shouldAutoAcceptFriendRequest(notification.receiveUserId)) {
    await acceptFriendRequestAutomatically(notificationRef);
    console.log(
      `example.comアカウント宛の友達申請を自動承認しました: ${notificationId}`
    );
    return;
  }

  await sendFriendRequestNotification(notificationId, notification);
}

async function sendFriendRequestNotification(
  notificationId: string,
  notification: admin.firestore.DocumentData
): Promise<void> {
  const fcmTokens = await getRecipientFcmTokens(
    notification.receiveUserId,
    "友達申請通知"
  );
  if (fcmTokens.length === 0) {
    return;
  }

  const message: MessageWithoutToken = {
    notification: {
      title: "友達申請が届きました",
      body: `${notification.sendUserDisplayName || "新しいユーザー"}さんから友達申請が届いています`,
    },
    data: {
      type: "friend_request",
      notificationId,
      fromUserId: notification.sendUserId,
      toUserId: notification.receiveUserId,
      timestamp: Date.now().toString(),
    },
    android: {
      notification: {
        icon: "notification_icon",
        color: "#ffa600",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: 1,
          sound: "default",
        },
      },
    },
  };

  await sendToFcmTokens(fcmTokens, message, "友達申請通知");
}

async function sendGroupInvitationNotification(
  notificationId: string,
  notification: admin.firestore.DocumentData
): Promise<void> {
  const fcmTokens = await getRecipientFcmTokens(
    notification.receiveUserId,
    "グループ招待通知"
  );
  if (fcmTokens.length === 0) {
    return;
  }

  const groupDoc = await admin.firestore()
    .collection("groups")
    .doc(notification.groupId)
    .get();

  if (!groupDoc.exists) {
    console.error("グループが存在しません:", notification.groupId);
    return;
  }

  const groupData = groupDoc.data();
  if (!groupData) {
    console.error("グループデータが空です:", notification.groupId);
    return;
  }

  const message: MessageWithoutToken = {
    notification: {
      title: "グループ招待が届きました",
      body: `${notification.sendUserDisplayName || "新しいユーザー"}さんから「${groupData.name}」グループへの招待が届いています`,
    },
    data: {
      type: "group_invitation",
      notificationId,
      fromUserId: notification.sendUserId,
      toUserId: notification.receiveUserId,
      groupId: notification.groupId,
      groupName: groupData.name,
      timestamp: Date.now().toString(),
    },
    android: {
      notification: {
        icon: "notification_icon",
        color: "#ffa600",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: 1,
          sound: "default",
        },
      },
    },
  };

  await sendToFcmTokens(fcmTokens, message, "グループ招待通知");
}

async function sendReactionNotification(
  notificationId: string,
  notification: admin.firestore.DocumentData
): Promise<void> {
  const fcmTokens = await getRecipientFcmTokens(
    notification.receiveUserId,
    "リアクション通知"
  );
  if (fcmTokens.length === 0) {
    return;
  }

  const message: MessageWithoutToken = {
    notification: {
      title: "新しいリアクション",
      body: `${notification.sendUserDisplayName || "新しいユーザー"}さんがあなたの投稿にリアクションしました`,
    },
    data: {
      type: "reaction",
      notificationId,
      fromUserId: notification.sendUserId,
      toUserId: notification.receiveUserId,
      relatedItemId: notification.relatedItemId,
      interactionId: notification.interactionId,
      timestamp: Date.now().toString(),
    },
    android: {
      notification: {
        icon: "notification_icon",
        color: "#ffa600",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: 1,
          sound: "default",
        },
      },
    },
  };

  await sendToFcmTokens(fcmTokens, message, "リアクション通知");
}

async function sendCommentNotification(
  notificationId: string,
  notification: admin.firestore.DocumentData
): Promise<void> {
  const fcmTokens = await getRecipientFcmTokens(
    notification.receiveUserId,
    "コメント通知"
  );
  if (fcmTokens.length === 0) {
    return;
  }

  const commentContent = await getNotificationCommentContent(notification);

  const message: MessageWithoutToken = {
    notification: {
      title: "新しいコメント",
      body: `${notification.sendUserDisplayName || "新しいユーザー"}さんがあなたの投稿にコメントしました${commentContent ? ": " + commentContent : ""}`,
    },
    data: {
      type: "comment",
      notificationId,
      fromUserId: notification.sendUserId,
      toUserId: notification.receiveUserId,
      relatedItemId: notification.relatedItemId,
      interactionId: notification.interactionId,
      commentContent,
      timestamp: Date.now().toString(),
    },
    android: {
      notification: {
        icon: "notification_icon",
        color: "#ffa600",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: 1,
          sound: "default",
        },
      },
    },
  };

  await sendToFcmTokens(fcmTokens, message, "コメント通知");
}

async function getNotificationCommentContent(
  notification: admin.firestore.DocumentData
): Promise<string> {
  if (!notification.interactionId) {
    return "";
  }

  try {
    const commentDoc = await admin.firestore()
      .collection("schedules")
      .doc(notification.relatedItemId)
      .collection("comments")
      .doc(notification.interactionId)
      .get();

    const commentContent = commentDoc.data()?.content || "";
    if (commentContent.length > 50) {
      return `${commentContent.substring(0, 47)}...`;
    }

    return commentContent;
  } catch (e) {
    console.error("コメントデータ取得エラー:", e);
    return "";
  }
}
