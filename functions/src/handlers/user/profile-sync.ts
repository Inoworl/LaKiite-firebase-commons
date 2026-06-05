import * as admin from "firebase-admin";

export interface UserProfileSnapshot {
  displayName?: string | null;
  iconUrl?: string | null;
}

export const PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT = 500;

export interface BuildUserProfileUpdatesInput {
  userId: string;
  before: UserProfileSnapshot;
  after: UserProfileSnapshot;
  updatedAt: Date;
}

export interface UserProfileUpdateData {
  id: string;
  userId: string;
  fieldName: "displayName" | "iconUrl";
  oldValue: string;
  newValue: string;
  updatedAt: Date;
  isProcessed: boolean;
  retryCount: number;
}

interface NotificationSnapshot {
  sendUserId?: string;
  receiveUserId?: string;
}

interface BuildNotificationSnapshotUpdateInput {
  userId: string;
  notification: NotificationSnapshot;
  latestUpdates: Record<string, string>;
}

/**
 * users/{userId} の変更前後から、同期対象のプロフィール更新履歴を生成する。
 */
export function buildUserProfileUpdates({
  userId,
  before,
  after,
  updatedAt,
}: BuildUserProfileUpdatesInput): UserProfileUpdateData[] {
  const timestamp = updatedAt.getTime();
  const updates: UserProfileUpdateData[] = [];

  if (before.displayName !== after.displayName) {
    updates.push({
      id: `${userId}_displayName_${timestamp}`,
      userId,
      fieldName: "displayName",
      oldValue: before.displayName || "",
      newValue: after.displayName || "",
      updatedAt,
      isProcessed: false,
      retryCount: 0,
    });
  }

  if (before.iconUrl !== after.iconUrl) {
    updates.push({
      id: `${userId}_iconUrl_${timestamp}`,
      userId,
      fieldName: "iconUrl",
      oldValue: before.iconUrl || "",
      newValue: after.iconUrl || "",
      updatedAt,
      isProcessed: false,
      retryCount: 0,
    });
  }

  return updates;
}

/**
 * コメント・リアクションに保存された投稿者スナップショットの更新値を返す。
 */
export function buildProfileSnapshotUpdate(
  latestUpdates: Record<string, string>
) {
  const updateData: Record<string, string> = {};

  if (hasUpdateField(latestUpdates, "displayName")) {
    updateData.userDisplayName = latestUpdates.displayName;
  }
  if (hasUpdateField(latestUpdates, "iconUrl")) {
    updateData.userPhotoUrl = latestUpdates.iconUrl;
  }

  return updateData;
}

/**
 * 予定に保存された所有者スナップショットの更新値を返す。
 */
export function buildScheduleOwnerSnapshotUpdate(
  latestUpdates: Record<string, string>
) {
  const updateData: Record<string, string> = {};

  if (hasUpdateField(latestUpdates, "displayName")) {
    updateData.ownerDisplayName = latestUpdates.displayName;
  }
  if (hasUpdateField(latestUpdates, "iconUrl")) {
    updateData.ownerPhotoUrl = latestUpdates.iconUrl;
  }

  return updateData;
}

/**
 * 通知に保存された送信者・受信者表示名スナップショットの更新値を返す。
 */
export function buildNotificationSnapshotUpdate({
  userId,
  notification,
  latestUpdates,
}: BuildNotificationSnapshotUpdateInput) {
  const updateData: Record<string, string> = {};

  if (!hasUpdateField(latestUpdates, "displayName")) {
    return updateData;
  }

  if (notification.sendUserId === userId) {
    updateData.sendUserDisplayName = latestUpdates.displayName;
  }
  if (notification.receiveUserId === userId) {
    updateData.receiveUserDisplayName = latestUpdates.displayName;
  }

  return updateData;
}

function hasUpdateField(
  latestUpdates: Record<string, string>,
  fieldName: string
) {
  return Object.prototype.hasOwnProperty.call(latestUpdates, fieldName);
}

/**
 * ユーザープロフィール変更を、画面に残る表示用スナップショットへ同期する。
 */
export async function syncUserProfileSnapshots(
  userId: string,
  latestUpdates: Record<string, string>
) {
  await Promise.all([
    updateCollectionGroupSnapshots("reactions", userId, latestUpdates),
    updateCollectionGroupSnapshots("comments", userId, latestUpdates),
    updateScheduleOwnerSnapshots(userId, latestUpdates),
    updateNotificationSnapshots(userId, latestUpdates),
  ]);
}

async function updateCollectionGroupSnapshots(
  collectionId: string,
  userId: string,
  latestUpdates: Record<string, string>
) {
  const updateData = buildProfileSnapshotUpdate(latestUpdates);
  if (Object.keys(updateData).length === 0) {
    return;
  }

  const snapshot = await admin
    .firestore()
    .collectionGroup(collectionId)
    .where("userId", "==", userId)
    .limit(PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT)
    .get();

  await commitBatches(snapshot.docs, (batch, doc) => {
    batch.update(doc.ref, updateData);
  });
}

async function updateScheduleOwnerSnapshots(
  userId: string,
  latestUpdates: Record<string, string>
) {
  const updateData = buildScheduleOwnerSnapshotUpdate(latestUpdates);
  if (Object.keys(updateData).length === 0) {
    return;
  }

  const snapshot = await admin
    .firestore()
    .collection("schedules")
    .where("ownerId", "==", userId)
    .limit(PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT)
    .get();

  await commitBatches(snapshot.docs, (batch, doc) => {
    batch.update(doc.ref, updateData);
  });
}

async function updateNotificationSnapshots(
  userId: string,
  latestUpdates: Record<string, string>
) {
  if (!hasUpdateField(latestUpdates, "displayName")) {
    return;
  }

  const [sentSnapshot, receivedSnapshot] = await Promise.all([
    admin.firestore().collection("notifications")
      .where("sendUserId", "==", userId)
      .limit(PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT)
      .get(),
    admin.firestore().collection("notifications")
      .where("receiveUserId", "==", userId)
      .limit(PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT)
      .get(),
  ]);
  const docsById = new Map<string, admin.firestore.QueryDocumentSnapshot>();

  sentSnapshot.docs.forEach((doc) => docsById.set(doc.id, doc));
  receivedSnapshot.docs.forEach((doc) => docsById.set(doc.id, doc));

  await commitBatches(Array.from(docsById.values()), (batch, doc) => {
    const updateData = buildNotificationSnapshotUpdate({
      userId,
      notification: doc.data(),
      latestUpdates,
    });

    if (Object.keys(updateData).length > 0) {
      batch.update(doc.ref, updateData);
    }
  });
}

async function commitBatches<T>(
  docs: T[],
  apply: (batch: admin.firestore.WriteBatch, doc: T) => void
) {
  const batches: admin.firestore.WriteBatch[] = [];
  let currentBatch = admin.firestore().batch();
  let operationCount = 0;

  docs.forEach((doc) => {
    apply(currentBatch, doc);
    operationCount++;

    if (operationCount >= 500) {
      batches.push(currentBatch);
      currentBatch = admin.firestore().batch();
      operationCount = 0;
    }
  });

  if (operationCount > 0) {
    batches.push(currentBatch);
  }

  await Promise.all(batches.map((batch) => batch.commit()));
}
