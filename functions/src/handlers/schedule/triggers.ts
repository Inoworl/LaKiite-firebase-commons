import * as functions from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

/**
 * スケジュールのリアクションが追加されたときに自動的にカウンターを更新する
 */
export const onCreateReaction = functions.onDocumentCreated({
  document: "schedules/{scheduleId}/reactions/{reactionId}",
  region: "asia-northeast1"
}, async (event) => {
  try {
    const scheduleId = event.params.scheduleId;
    console.log(`リアクション追加: scheduleId=${scheduleId}, reactionId=${event.params.reactionId}`);

    // スケジュールドキュメントのリアクション数をインクリメント
    await admin.firestore()
      .collection("schedules")
      .doc(scheduleId)
      .update({
        "reactionCount": admin.firestore.FieldValue.increment(1),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`スケジュール(${scheduleId})のリアクション数を増加しました`);
    return null;
  } catch (error) {
    console.error("リアクション数増加エラー:", error);
    return null;
  }
});

/**
 * スケジュールのリアクションが削除されたときに自動的にカウンターを更新する
 */
export const onDeleteReaction = functions.onDocumentDeleted({
  document: "schedules/{scheduleId}/reactions/{reactionId}",
  region: "asia-northeast1"
}, async (event) => {
  try {
    const scheduleId = event.params.scheduleId;
    console.log(`リアクション削除: scheduleId=${scheduleId}, reactionId=${event.params.reactionId}`);

    // スケジュールドキュメントのリアクション数をデクリメント
    await admin.firestore()
      .collection("schedules")
      .doc(scheduleId)
      .update({
        "reactionCount": admin.firestore.FieldValue.increment(-1),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`スケジュール(${scheduleId})のリアクション数を減少しました`);
    return null;
  } catch (error) {
    console.error("リアクション数減少エラー:", error);
    return null;
  }
});

/**
 * スケジュールのコメントが追加されたときに自動的にカウンターを更新する
 */
export const onCreateComment = functions.onDocumentCreated({
  document: "schedules/{scheduleId}/comments/{commentId}",
  region: "asia-northeast1"
}, async (event) => {
  try {
    const scheduleId = event.params.scheduleId;
    console.log(`コメント追加: scheduleId=${scheduleId}, commentId=${event.params.commentId}`);

    await admin.firestore()
      .collection("schedules")
      .doc(scheduleId)
      .update({
        "commentCount": admin.firestore.FieldValue.increment(1),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`スケジュール(${scheduleId})のコメント数を増加しました`);
    return null;
  } catch (error) {
    console.error("コメント数増加エラー:", error);
    return null;
  }
});

/**
 * スケジュールのコメントが削除されたときに自動的にカウンターを更新する
 */
export const onDeleteComment = functions.onDocumentDeleted({
  document: "schedules/{scheduleId}/comments/{commentId}",
  region: "asia-northeast1"
}, async (event) => {
  try {
    const scheduleId = event.params.scheduleId;
    console.log(`コメント削除: scheduleId=${scheduleId}, commentId=${event.params.commentId}`);

    await admin.firestore()
      .collection("schedules")
      .doc(scheduleId)
      .update({
        "commentCount": admin.firestore.FieldValue.increment(-1),
        "updatedAt": admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`スケジュール(${scheduleId})のコメント数を減少しました`);
    return null;
  } catch (error) {
    console.error("コメント数減少エラー:", error);
    return null;
  }
});
