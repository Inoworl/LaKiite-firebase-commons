import * as functions from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

/**
 * バッチ処理の監視とアラート
 */
export const batchProcessMonitoring = functions.onSchedule(
  {
    schedule: "0 8 * * *", // 毎日午前8時
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
    try {
      console.log("バッチ処理監視開始");

      // 前日の処理状況を確認
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 未処理の履歴を確認
      const unprocessedSnapshot = await admin
        .firestore()
        .collection("user_update_history")
        .where("isProcessed", "==", false)
        .where("updatedAt", ">=", admin.firestore.Timestamp.fromDate(yesterday))
        .where("updatedAt", "<", admin.firestore.Timestamp.fromDate(today))
        .count()
        .get();

      // 失敗した処理を確認
      const failedSnapshot = await admin
        .firestore()
        .collection("user_update_history")
        .where("retryCount", ">=", 3)
        .where("updatedAt", ">=", admin.firestore.Timestamp.fromDate(yesterday))
        .where("updatedAt", "<", admin.firestore.Timestamp.fromDate(today))
        .count()
        .get();

      // 処理済みの履歴を確認
      const processedSnapshot = await admin
        .firestore()
        .collection("user_update_history")
        .where("isProcessed", "==", true)
        .where("updatedAt", ">=", admin.firestore.Timestamp.fromDate(yesterday))
        .where("updatedAt", "<", admin.firestore.Timestamp.fromDate(today))
        .count()
        .get();

      const unprocessedCount = unprocessedSnapshot.data().count;
      const failedCount = failedSnapshot.data().count;
      const processedCount = processedSnapshot.data().count;

      const stats = {
        date: yesterday.toISOString().split("T")[0],
        unprocessedCount,
        failedCount,
        processedCount,
        totalCount: unprocessedCount + failedCount + processedCount,
      };

      console.log("バッチ処理統計:", stats);

      // アラート条件
      const shouldAlert = stats.unprocessedCount > 10 || stats.failedCount > 0;

      if (shouldAlert) {
        console.warn(
          `バッチ処理アラート: 未処理=${stats.unprocessedCount}件, 失敗=${stats.failedCount}件`
        );

        // 管理者への通知
        await sendAdminAlert(stats);
      } else {
        console.log("バッチ処理正常: すべて処理済み");
      }

      // 統計情報をFirestoreに保存
      await saveBatchStats(stats);

    } catch (error) {
      console.error("監視処理エラー:", error);

      // 監視処理自体のエラーも通知
      await sendAdminAlert({
        date: new Date().toISOString().split("T")[0],
        error: error instanceof Error ? error.message : String(error),
        type: "monitoring_error",
      });
    }
  }
);

/**
 * 管理者アラートの送信
 */
async function sendAdminAlert(data: Record<string, unknown>) {
  try {
    // アラート情報をFirestoreに保存
    await admin.firestore().collection("admin_alerts").add({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      type: data.type || "batch_process_alert",
      severity: data.failedCount && (data.failedCount as number) > 0 ? "high" : "medium",
    });

    console.log("管理者アラートを記録:", data);

    // 実際の通知送信（Slack、メール等）は要件に応じて実装
    // await sendSlackNotification(data);
    // await sendEmailNotification(data);
  } catch (error) {
    console.error("アラート送信エラー:", error);
  }
}

/**
 * バッチ処理統計の保存
 */
async function saveBatchStats(stats: Record<string, unknown>) {
  try {
    await admin.firestore().collection("batch_process_stats").add({
      ...stats,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("バッチ処理統計を保存:", stats);
  } catch (error) {
    console.error("統計保存エラー:", error);
  }
}
