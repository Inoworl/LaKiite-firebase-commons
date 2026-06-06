import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { processUserUpdates, UserUpdateData } from "./batch-sync";
import { AdminAuthError, verifyAdminAuthorizationHeader } from "../auth/admin";

/**
 * 手動でバッチ処理を実行するHTTPS関数
 */
export const manualUserDataSync = functions.onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (req, res) => {
    try {
      // CORS設定
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      let decodedToken;
      try {
        decodedToken = await verifyAdminAuthorizationHeader(
          req.headers.authorization
        );
      } catch (error) {
        if (error instanceof AdminAuthError) {
          res.status(error.status).send(error.response);
          return;
        }
        throw error;
      }

      console.log(`手動同期実行: ユーザー ${decodedToken.uid}`);

      // 特定ユーザーの処理または全体処理
      const userId = req.query.userId as string;
      const forceProcess = req.query.force === "true";

      if (userId) {
        const result = await processSingleUser(userId, forceProcess);
        res.status(200).send({
          success: true,
          message: `ユーザー ${userId} の処理完了`,
          result,
        });
      } else {
        const result = await processAllPendingUpdates(forceProcess);
        res.status(200).send({
          success: true,
          message: "全体処理完了",
          result,
        });
      }
    } catch (error) {
      console.error("手動同期エラー:", error);
      res.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * 特定ユーザーの手動処理
 */
async function processSingleUser(userId: string, forceProcess = false) {
  console.log(`単一ユーザー処理開始: ${userId}, force: ${forceProcess}`);

  let query = admin
    .firestore()
    .collection("user_update_history")
    .where("userId", "==", userId);

  if (!forceProcess) {
    query = query.where("isProcessed", "==", false);
  }

  const updates = await query.get();

  if (updates.empty) {
    console.log(`ユーザー ${userId}: 処理対象なし`);
    return {
      userId,
      updatesFound: 0,
      processed: 0,
    };
  }

  const updateData = updates.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as UserUpdateData[];

  console.log(`ユーザー ${userId}: ${updateData.length}件の更新を処理`);

  await processUserUpdates(userId, updateData);

  return {
    userId,
    updatesFound: updateData.length,
    processed: updateData.length,
  };
}

/**
 * 全体の手動処理
 */
async function processAllPendingUpdates(forceProcess = false) {
  console.log(`全体処理開始: force: ${forceProcess}`);

  let baseQuery = admin.firestore().collection("user_update_history");

  if (!forceProcess) {
    baseQuery = baseQuery
      .where("isProcessed", "==", false)
      .where("retryCount", "<", 3) as admin.firestore.CollectionReference;
  }

  const pendingSnapshot = await baseQuery.limit(500).get();

  if (pendingSnapshot.empty) {
    console.log("処理対象の更新履歴がありません");
    return {
      totalUpdates: 0,
      processedUsers: 0,
      errors: 0,
    };
  }

  console.log(`${pendingSnapshot.size}件の更新履歴を処理`);

  // ユーザーIDごとにグループ化
  const updatesByUser = new Map<string, UserUpdateData[]>();
  pendingSnapshot.docs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() } as UserUpdateData;
    const userId = data.userId;

    if (!updatesByUser.has(userId)) {
      updatesByUser.set(userId, []);
    }
    const userUpdates = updatesByUser.get(userId);
    if (userUpdates) {
      userUpdates.push(data);
    }
  });

  // 各ユーザーの更新を並列処理
  const promises = Array.from(updatesByUser.entries()).map(
    ([userId, updates]) => processUserUpdates(userId, updates)
  );

  const results = await Promise.allSettled(promises);

  // 結果の集計
  let successCount = 0;
  let errorCount = 0;
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      successCount++;
    } else {
      errorCount++;
      console.error("ユーザー処理エラー:", result.reason);
    }
  });

  return {
    totalUpdates: pendingSnapshot.size,
    processedUsers: successCount,
    errors: errorCount,
  };
}

/**
 * 処理状況の取得
 */
export const getUserDataSyncStatus = functions.onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (req, res) => {
    try {
      // CORS設定
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "GET") {
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

      // 統計情報を取得
      const [pending, failed, processed] = await Promise.all([
        admin
          .firestore()
          .collection("user_update_history")
          .where("isProcessed", "==", false)
          .count()
          .get(),
        admin
          .firestore()
          .collection("user_update_history")
          .where("retryCount", ">=", 3)
          .count()
          .get(),
        admin
          .firestore()
          .collection("user_update_history")
          .where("isProcessed", "==", true)
          .count()
          .get(),
      ]);

      // 最新の統計情報を取得
      const latestStats = await admin
        .firestore()
        .collection("batch_process_stats")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      const status = {
        pending: pending.data().count,
        failed: failed.data().count,
        processed: processed.data().count,
        total:
          pending.data().count + failed.data().count + processed.data().count,
        lastBatchStats: latestStats.empty ? null : latestStats.docs[0].data(),
        timestamp: new Date().toISOString(),
      };

      res.status(200).send(status);
    } catch (error) {
      console.error("ステータス取得エラー:", error);
      res.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
