import * as functions from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { cleanupRetiredUserReferences } from "./deletion-cleanup";
import { processUserUpdates } from "./batch-sync";
import { buildUserProfileUpdates } from "./profile-sync";
import { onScheduleDigestUserCreated } from "../schedule-digest/triggers";

export const onUserCreated = functions.onDocumentCreated(
  {
    document: "users/{userId}",
    region: "asia-northeast1",
  },
  async (event) => {
    try {
      await onScheduleDigestUserCreated(event.params.userId);
      console.log(`朝通知設定の初期作成完了: ${event.params.userId}`);
    } catch (error) {
      console.error("朝通知設定の初期作成エラー:", error);
    }
  }
);

/**
 * ユーザー情報更新時に履歴を記録
 */
export const onUserUpdate = functions.onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "asia-northeast1",
  },
  async (event) => {
    try {
      const userId = event.params.userId;
      const before = event.data?.before.data();
      const after = event.data?.after.data();

      if (!before || !after) {
        console.log("データが存在しません");
        return;
      }

      const updatedAt = new Date();
      const updates = buildUserProfileUpdates({
        userId,
        before,
        after,
        updatedAt,
      });

      if (updates.length === 0) {
        console.log(`関連フィールドの変更なし: ${userId}`);
        return;
      }

      const batch = admin.firestore().batch();
      updates.forEach((update) => {
        const historyRef = admin
          .firestore()
          .collection("user_update_history")
          .doc(update.id);
        batch.set(historyRef, {
          ...update,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      console.log(`ユーザー更新履歴を記録: ${userId}, ${updates.length}件`);

      await processUserUpdates(userId, updates);
      console.log(`ユーザープロフィール即時同期完了: ${userId}`);
    } catch (error) {
      console.error("ユーザー更新履歴記録エラー:", error);
      // エラーが発生してもトリガーは失敗させない
    }
  }
);

/**
 * ユーザー削除時に、画面に残る参照を退会済みユーザーとして扱える状態へ更新する。
 *
 * コメント・リアクション・通知に残る表示用スナップショットを匿名化し、
 * 他ユーザーのfriends配列から削除済みユーザーIDを取り除く。
 */
export const onUserDeleted = functions.onDocumentDeleted(
  {
    document: "users/{userId}",
    region: "asia-northeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async (event) => {
    try {
      const userId = event.params.userId;
      await cleanupRetiredUserReferences(userId);
      console.log(`退会済みユーザー参照のクリーンアップ完了: ${userId}`);
    } catch (error) {
      console.error("退会済みユーザー参照のクリーンアップエラー:", error);
      throw error;
    }
  }
);
