import { expect } from "chai";
import firebaseAdmin = require("firebase-admin");
import { isExampleEmail } from "../notification-service";

type SendNotificationRequest = Parameters<
  typeof import("../notification-service").sendNotification
>[0];
type SendNotificationResponse = Parameters<
  typeof import("../notification-service").sendNotification
>[1];
type NotificationCreatedEvent = Parameters<
  typeof import("../notification-service").onNotificationCreated.run
>[0];

type AdminModule = {
  auth?: () => {
    verifyIdToken: (token: string) => Promise<Record<string, unknown>>;
    getUser?: (userId: string) => Promise<Record<string, unknown>>;
  };
  firestore?: () => {
    collection: (name: string) => CollectionMock;
  };
  messaging?: () => {
    send: (message: Record<string, unknown>) => Promise<string>;
    sendEach: (
      messages: Record<string, unknown>[]
    ) => Promise<{
      successCount: number;
      failureCount: number;
      responses: { success: boolean }[];
    }>;
  };
};

type CollectionMock = {
  doc: (id: string) => DocumentMock;
};

type DocumentMock = {
  get: () => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  collection: (name: string) => CollectionMock;
};

type MockResponse = SendNotificationResponse & {
  statusCodeValue?: number;
  body?: unknown;
  headers: Record<string, string | string[]>;
};

function replaceAdminExport(
  name: keyof AdminModule,
  value: unknown
): () => void {
  const adminModule = firebaseAdmin as unknown as AdminModule;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    adminModule,
    name
  );

  Object.defineProperty(adminModule, name, {
    configurable: true,
    value,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(adminModule, name, originalDescriptor);
    } else {
      delete adminModule[name];
    }
  };
}

function mockAdminAuth(
  verifyIdToken: (token: string) => Promise<Record<string, unknown>>
): () => void {
  return replaceAdminExport("auth", () => ({ verifyIdToken }));
}

function mockMessaging(
  sentMessages: Record<string, unknown>[],
  sentEachBatches: Record<string, unknown>[][]
): () => void {
  return replaceAdminExport("messaging", () => ({
    send: async (message: Record<string, unknown>) => {
      sentMessages.push(message);
      return "mock-message-id";
    },
    sendEach: async (messages: Record<string, unknown>[]) => {
      sentEachBatches.push(messages);
      return {
        successCount: messages.length,
        failureCount: 0,
        responses: messages.map(() => ({ success: true })),
      };
    },
  }));
}

function mockFirestore(
  documents: Record<string, Record<string, unknown>>
): () => void {
  const createCollection = (path: string[]): CollectionMock => ({
    doc: (id: string) => createDocument([...path, id]),
  });
  const createDocument = (path: string[]): DocumentMock => ({
    get: async () => {
      const data = documents[path.join("/")];
      return {
        exists: data !== undefined,
        data: () => data,
      };
    },
    collection: (name: string) => createCollection([...path, name]),
  });

  return replaceAdminExport("firestore", () => ({
    collection: (name: string) => createCollection([name]),
  }));
}

function createResponse(): MockResponse {
  const response = { headers: {} } as unknown as MockResponse;

  response.on = () => response;
  response.status = (code: number) => {
    response.statusCodeValue = code;
    return response;
  };
  response.send = (body: unknown) => {
    response.body = body;
    return response;
  };
  response.set = (name: string, value?: string | string[]) => {
    response.headers[name] = value ?? "";
    return response;
  };
  response.setHeader = (name: string, value: string | string[]) => {
    response.headers[name] = value;
    return response;
  };
  response.getHeader = (name: string) => response.headers[name];
  response.end = (body?: unknown) => {
    response.body = body;
    return response;
  };

  return response;
}

function createNotificationEvent(
  notificationId: string,
  notification: Record<string, unknown>
): NotificationCreatedEvent {
  return {
    params: { notificationId },
    data: {
      data: () => notification,
    },
  } as unknown as NotificationCreatedEvent;
}

describe("Notification service exports", () => {
  it("uses one Firestore create trigger for notification dispatch", async () => {
    const notificationService = await import("../notification-service");
    const legacyExports = notificationService as Record<string, unknown>;

    expect(notificationService.onNotificationCreated).to.not.be.undefined;
    expect(legacyExports.onNewFriendRequest).to.equal(undefined);
    expect(legacyExports.onNewGroupInvitation).to.equal(undefined);
    expect(legacyExports.onNewReactionNotification).to.equal(undefined);
    expect(legacyExports.onNewCommentNotification).to.equal(undefined);
  });

  describe("sendNotification", () => {
    it("rejects requests without an admin bearer token", async () => {
      const notificationService = await import("../notification-service");
      const response = createResponse();

      await notificationService.sendNotification(
        {
          method: "POST",
          headers: {},
          body: {
            token: "fcm-token",
            notification: { title: "title", body: "body" },
            data: { type: "custom" },
          },
        } as unknown as SendNotificationRequest,
        response
      );

      expect(response.statusCodeValue).to.equal(401);
      expect(response.body).to.deep.equal({ error: "認証が必要です" });
    });

    it("rejects non-admin Firebase ID tokens before sending FCM", async () => {
      const restoreAdminAuth = mockAdminAuth(async () => ({
        uid: "user-1",
        admin: false,
      }));
      const sentMessages: Record<string, unknown>[] = [];
      const restoreMessaging = mockMessaging(sentMessages, []);

      try {
        const notificationService = await import("../notification-service");
        const response = createResponse();

        await notificationService.sendNotification(
          {
            method: "POST",
            headers: { authorization: "Bearer user-token" },
            body: {
              token: "fcm-token",
              notification: { title: "title", body: "body" },
              data: { type: "custom" },
            },
          } as unknown as SendNotificationRequest,
          response
        );

        expect(response.statusCodeValue).to.equal(403);
        expect(response.body).to.deep.equal({ error: "管理者権限が必要です" });
        expect(sentMessages).to.deep.equal([]);
      } finally {
        restoreMessaging();
        restoreAdminAuth();
      }
    });

    it("sends the same FCM payload for admin requests", async () => {
      const restoreAdminAuth = mockAdminAuth(async () => ({
        uid: "admin-user",
        admin: true,
      }));
      const sentMessages: Record<string, unknown>[] = [];
      const restoreMessaging = mockMessaging(sentMessages, []);

      try {
        const notificationService = await import("../notification-service");
        const response = createResponse();

        await notificationService.sendNotification(
          {
            method: "POST",
            headers: { authorization: "Bearer admin-token" },
            body: {
              token: "fcm-token",
              notification: { title: "title", body: "body" },
              data: { type: "custom", customKey: "custom-value" },
            },
          } as unknown as SendNotificationRequest,
          response
        );

        expect(response.statusCodeValue).to.equal(200);
        expect(response.body).to.deep.equal({
          success: true,
          messageId: "mock-message-id",
        });
        expect(sentMessages).to.have.length(1);
        expect(sentMessages[0]).to.include({
          token: "fcm-token",
        });
        expect(sentMessages[0].notification).to.deep.equal({
          title: "title",
          body: "body",
        });
        expect(sentMessages[0].data).to.deep.equal({
          type: "custom",
          customKey: "custom-value",
        });
      } finally {
        restoreMessaging();
        restoreAdminAuth();
      }
    });
  });

  describe("onNotificationCreated", () => {
    it("dispatches friend request notifications with the legacy payload", async () => {
      const sentEachBatches: Record<string, unknown>[][] = [];
      const restoreAdminAuth = replaceAdminExport("auth", () => ({
        verifyIdToken: async () => ({ uid: "admin-user", admin: true }),
        getUser: async () => ({ email: "receive-user@example.jp" }),
      }));
      const restoreMessaging = mockMessaging([], sentEachBatches);
      const restoreFirestore = mockFirestore({
        "users/receive-user": {
          fcmTokens: ["token-1", "token-1", "token-2", ""],
        },
      });

      try {
        const notificationService = await import("../notification-service");

        await notificationService.onNotificationCreated.run(
          createNotificationEvent("notification-1", {
            type: "friend",
            status: "pending",
            sendUserId: "send-user",
            receiveUserId: "receive-user",
            sendUserDisplayName: "送信者",
          })
        );

        expect(sentEachBatches).to.have.length(1);
        expect(sentEachBatches[0]).to.have.length(2);
        expect(sentEachBatches[0][0].token).to.equal("token-1");
        expect(sentEachBatches[0][1].token).to.equal("token-2");
        expect(sentEachBatches[0][0].notification).to.deep.equal({
          title: "友達申請が届きました",
          body: "送信者さんから友達申請が届いています",
        });
        expect(sentEachBatches[0][0].data).to.include({
          type: "friend_request",
          notificationId: "notification-1",
          fromUserId: "send-user",
          toUserId: "receive-user",
        });
      } finally {
        restoreFirestore();
        restoreMessaging();
        restoreAdminAuth();
      }
    });

    it("dispatches group invitation notifications with group details", async () => {
      const sentEachBatches: Record<string, unknown>[][] = [];
      const restoreMessaging = mockMessaging([], sentEachBatches);
      const restoreFirestore = mockFirestore({
        "users/receive-user": { fcmTokens: ["token-1"] },
        "groups/group-1": { name: "テストグループ" },
      });

      try {
        const notificationService = await import("../notification-service");

        await notificationService.onNotificationCreated.run(
          createNotificationEvent("notification-2", {
            type: "groupInvitation",
            sendUserId: "send-user",
            receiveUserId: "receive-user",
            sendUserDisplayName: "送信者",
            groupId: "group-1",
          })
        );

        expect(sentEachBatches).to.have.length(1);
        expect(sentEachBatches[0][0].notification).to.deep.equal({
          title: "グループ招待が届きました",
          body: "送信者さんから「テストグループ」グループへの招待が届いています",
        });
        expect(sentEachBatches[0][0].data).to.include({
          type: "group_invitation",
          notificationId: "notification-2",
          fromUserId: "send-user",
          toUserId: "receive-user",
          groupId: "group-1",
          groupName: "テストグループ",
        });
      } finally {
        restoreFirestore();
        restoreMessaging();
      }
    });

    it("dispatches reaction notifications with related item fields", async () => {
      const sentEachBatches: Record<string, unknown>[][] = [];
      const restoreMessaging = mockMessaging([], sentEachBatches);
      const restoreFirestore = mockFirestore({
        "users/receive-user": { fcmTokens: ["token-1"] },
      });

      try {
        const notificationService = await import("../notification-service");

        await notificationService.onNotificationCreated.run(
          createNotificationEvent("notification-3", {
            type: "reaction",
            sendUserId: "send-user",
            receiveUserId: "receive-user",
            sendUserDisplayName: "送信者",
            relatedItemId: "schedule-1",
            interactionId: "reaction-1",
          })
        );

        expect(sentEachBatches).to.have.length(1);
        expect(sentEachBatches[0][0].notification).to.deep.equal({
          title: "新しいリアクション",
          body: "送信者さんがあなたの投稿にリアクションしました",
        });
        expect(sentEachBatches[0][0].data).to.include({
          type: "reaction",
          notificationId: "notification-3",
          fromUserId: "send-user",
          toUserId: "receive-user",
          relatedItemId: "schedule-1",
          interactionId: "reaction-1",
        });
      } finally {
        restoreFirestore();
        restoreMessaging();
      }
    });

    it("dispatches comment notifications with truncated comment content", async () => {
      const sentEachBatches: Record<string, unknown>[][] = [];
      const restoreMessaging = mockMessaging([], sentEachBatches);
      const restoreFirestore = mockFirestore({
        "users/receive-user": { fcmTokens: ["token-1"] },
        "schedules/schedule-1/comments/comment-1": {
          content: "12345678901234567890123456789012345678901234567890more",
        },
      });

      try {
        const notificationService = await import("../notification-service");

        await notificationService.onNotificationCreated.run(
          createNotificationEvent("notification-4", {
            type: "comment",
            sendUserId: "send-user",
            receiveUserId: "receive-user",
            sendUserDisplayName: "送信者",
            relatedItemId: "schedule-1",
            interactionId: "comment-1",
          })
        );

        expect(sentEachBatches).to.have.length(1);
        expect(sentEachBatches[0][0].notification).to.deep.equal({
          title: "新しいコメント",
          body: "送信者さんがあなたの投稿にコメントしました: 12345678901234567890123456789012345678901234567...",
        });
        expect(sentEachBatches[0][0].data).to.include({
          type: "comment",
          notificationId: "notification-4",
          fromUserId: "send-user",
          toUserId: "receive-user",
          relatedItemId: "schedule-1",
          interactionId: "comment-1",
          commentContent: "12345678901234567890123456789012345678901234567...",
        });
      } finally {
        restoreFirestore();
        restoreMessaging();
      }
    });
  });

  describe("isExampleEmail", () => {
    it("returns true for example.com email addresses", () => {
      expect(isExampleEmail("test@example.com")).to.equal(true);
      expect(isExampleEmail("TEST@EXAMPLE.COM")).to.equal(true);
    });

    it("returns false for non-example.com email addresses", () => {
      expect(isExampleEmail("test@example.jp")).to.equal(false);
      expect(isExampleEmail(null)).to.equal(false);
      expect(isExampleEmail(undefined)).to.equal(false);
    });
  });
});
