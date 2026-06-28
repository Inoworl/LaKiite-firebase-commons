import * as admin from "firebase-admin";
import * as notificationService from "./notification-service";

// Firebase Admin SDKの初期化
admin.initializeApp();

// グループ関連のトリガーをエクスポート
export * from "./handlers/group/triggers";

// リスト関連のトリガーをエクスポート
export * from "./handlers/list/triggers";
export * from "./handlers/list/manual-sync";

// 通知関連のトリガーをエクスポート
export * from "./handlers/notification/triggers";

// スケジュール関連のトリガーをエクスポート
export * from "./handlers/schedule/triggers";
export * from "./handlers/schedule/encryption-migration";
export * from "./handlers/schedule-digest/triggers";
export * from "./handlers/schedule-digest/manual-sync";

// ユーザー関連のトリガーをエクスポート
export * from "./handlers/user/triggers";
export * from "./handlers/user/batch-sync";
export * from "./handlers/user/monitoring";
export * from "./handlers/user/manual-sync";

// Deep Link関連の関数をエクスポート
export * from "./handlers/deep-link/airbridge-invite-link";

// 通知関連の関数をエクスポート
export const sendNotification = notificationService.sendNotification;
export const onNotificationCreated = notificationService.onNotificationCreated;
