import * as functions from "firebase-functions/v2/https";
import { AdminAuthError, verifyAdminAuthorizationHeader } from "../auth/admin";
import { backfillAllScheduleVisibility } from "./utils";

/**
 * 既存予定の visibleTo を sharedLists の現在メンバーから再計算する手動同期。
 *
 * dev の検証と移行作業用。呼び出しには Firebase ID token が必要。
 * 現状の既存アプリには direct share のUIがないため、owner + list members
 * を正として再計算する。
 */
export const backfillScheduleVisibility = functions.onRequest(
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
        res.status(405).send({ error: "Method Not Allowed" });
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

      const result = await backfillAllScheduleVisibility();
      res.status(200).send({
        success: true,
        result,
      });
    } catch (error) {
      console.error("Schedule visibility backfill failed:", error);
      res.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
