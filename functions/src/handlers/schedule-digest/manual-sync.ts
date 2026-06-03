import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { backfillAllScheduleDigestSettings } from "./utils";

export const backfillScheduleDigestSettings = functions.onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (req, res) => {
    try {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).send({error: "Method Not Allowed"});
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).send({error: "認証が必要です"});
        return;
      }

      const token = authHeader.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      if (decodedToken.admin !== true) {
        res.status(403).send({error: "管理者権限が必要です"});
        return;
      }

      const result = await backfillAllScheduleDigestSettings();
      res.status(200).send({success: true, result});
    } catch (error) {
      console.error("Schedule digest settings backfill failed:", error);
      res.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
