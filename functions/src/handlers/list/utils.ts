import * as admin from "firebase-admin";
import {
  parseMigrationPrivateKeySecret,
  rewrapMigrationEncryptedScheduleKey,
  scheduleMigrationPrivateKey,
  ScheduleEncryptedKey,
} from "../schedule/encryption-migration";

type ListDataCache = Map<string, admin.firestore.DocumentData | null>;
type PublicKeyCache = Map<string, UserPublicKey | null>;

type UserPublicKey = {
  publicKey: string;
  keyVersion: number;
};

/**
 * リストメンバー変更時に関連する予定の可視性を更新する。
 *
 * 差分で visibleTo を足し引きすると、同じユーザーが複数リストから共有
 * されている場合に誤って閲覧権限を消してしまう。対象予定ごとに
 * sharedLists の全リストを読み直し、毎回 union を再計算する。
 * @param listId 変更されたリストのID
 * @param addedMembers 追加されたメンバーのIDリスト
 * @param removedMembers 削除されたメンバーのIDリスト
 */
export async function updateSchedulesVisibility(
  listId: string,
  addedMembers: string[],
  removedMembers: string[]
): Promise<void> {
  console.log(`Updating schedules visibility for list ${listId}`);
  console.log(`Added members: ${addedMembers.join(", ")}`);
  console.log(`Removed members: ${removedMembers.join(", ")}`);

  if (addedMembers.length === 0 && removedMembers.length === 0) {
    console.log("No member changes detected, skipping update");
    return;
  }

  await recomputeSchedulesVisibilityForList(listId);
}

/**
 * リスト削除時に、そのリストを共有元にしている予定から共有を外す。
 * @param listId 削除されたリストのID
 */
export async function removeDeletedListFromSchedules(
  listId: string
): Promise<void> {
  console.log(`Removing deleted list ${listId} from schedules`);
  await recomputeSchedulesVisibilityForList(listId, { removeListId: listId });
}

/**
 * 全予定の visibleTo を再計算する。既存データの backfill 用。
 */
export async function backfillAllScheduleVisibility(): Promise<{
  scanned: number;
  updated: number;
}> {
  const db = admin.firestore();
  const schedulesSnapshot = await db.collection("schedules").get();
  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  const listCache: ListDataCache = new Map();

  for (const scheduleDoc of schedulesSnapshot.docs) {
    const scheduleData = scheduleDoc.data();
    const sharedLists = asStringArray(scheduleData.sharedLists);

    if (sharedLists.length === 0) {
      continue;
    }

    const nextVisibleTo = await calculateVisibleTo(scheduleData, listCache);
    const currentVisibleTo = asStringArray(scheduleData.visibleTo);

    if (!arraysEqual([...nextVisibleTo].sort(), [...currentVisibleTo].sort())) {
      batch.update(scheduleDoc.ref, {
        visibleTo: nextVisibleTo,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batchCount++;
      updated++;
    }

    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return {
    scanned: schedulesSnapshot.size,
    updated,
  };
}

async function recomputeSchedulesVisibilityForList(
  listId: string,
  options: { removeListId?: string } = {}
): Promise<void> {
  const db = admin.firestore();

  try {
    const schedulesSnapshot = await db
      .collection("schedules")
      .where("sharedLists", "array-contains", listId)
      .get();

    console.log(`Found ${schedulesSnapshot.size} schedules using list ${listId}`);

    if (schedulesSnapshot.empty) {
      console.log("No schedules found for this list");
      return;
    }

    let batch = db.batch();
    let batchCount = 0;
    let updatedCount = 0;
    const listCache: ListDataCache = new Map();

    for (const scheduleDoc of schedulesSnapshot.docs) {
      const scheduleData = scheduleDoc.data();
      const currentVisibleToArray = asStringArray(scheduleData.visibleTo);
      const nextScheduleData = removeSharedListFromScheduleData(
        scheduleData,
        options.removeListId
      );
      const intendedVisibleTo = await calculateVisibleTo(
        nextScheduleData,
        listCache
      );
      const updateData: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
        visibleTo: intendedVisibleTo,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (scheduleData.encrypted === true) {
        Object.assign(
          updateData,
          await buildEncryptedScheduleAccessUpdate({
            scheduleData,
            intendedVisibleTo,
            publicKeyCache: new Map(),
            migrationSecretValue: readMigrationSecretValue(),
          })
        );
      }

      if (options.removeListId) {
        updateData.sharedLists = admin.firestore.FieldValue.arrayRemove(
          options.removeListId
        );
      }

      if (
        !arraysEqual(
          [...asStringArray(updateData.visibleTo)].sort(),
          [...currentVisibleToArray].sort()
        ) ||
        options.removeListId
      ) {
        batch.update(scheduleDoc.ref, updateData);
        batchCount++;
        updatedCount++;

        console.log(`Scheduled update for schedule ${scheduleDoc.id}: ${currentVisibleToArray.length} -> ${asStringArray(updateData.visibleTo).length} members`);

        if (batchCount >= 450) {
          await batch.commit();
          console.log(`Committed batch of ${batchCount} updates`);
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${batchCount} updates`);
    }

    console.log(`Successfully updated visibility for ${updatedCount} schedules in list ${listId}`);
  } catch (error) {
    console.error(`Error updating schedules visibility for list ${listId}:`, error);
    throw error;
  }
}

async function calculateVisibleTo(
  scheduleData: admin.firestore.DocumentData,
  listCache: ListDataCache = new Map()
): Promise<string[]> {
  const db = admin.firestore();
  const ownerId = typeof scheduleData.ownerId === "string" ? scheduleData.ownerId : "";
  const sharedLists = asStringArray(scheduleData.sharedLists);
  const visibleTo = new Set<string>();

  if (ownerId) {
    visibleTo.add(ownerId);
  }

  for (const sharedListId of sharedLists) {
    if (!listCache.has(sharedListId)) {
      const listDoc = await db.collection("lists").doc(sharedListId).get();
      listCache.set(sharedListId, listDoc.exists ? listDoc.data() || {} : null);
    }

    const listData = listCache.get(sharedListId);
    if (!listData) {
      console.warn(`Shared list not found: ${sharedListId}`);
      continue;
    }

    for (const memberId of asStringArray(listData.memberIds)) {
      visibleTo.add(memberId);
    }
  }

  return Array.from(visibleTo);
}

function removeSharedListFromScheduleData(
  scheduleData: admin.firestore.DocumentData,
  listId?: string
): admin.firestore.DocumentData {
  if (!listId) {
    return scheduleData;
  }

  return {
    ...scheduleData,
    sharedLists: asStringArray(scheduleData.sharedLists).filter(
      (sharedListId) => sharedListId !== listId
    ),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => {
    return typeof item === "string" && item.length > 0;
  });
}

async function buildEncryptedScheduleAccessUpdate({
  scheduleData,
  intendedVisibleTo,
  publicKeyCache,
  migrationSecretValue,
}: {
  scheduleData: admin.firestore.DocumentData;
  intendedVisibleTo: string[];
  publicKeyCache: PublicKeyCache;
  migrationSecretValue: string;
}): Promise<admin.firestore.UpdateData<admin.firestore.DocumentData>> {
  const encryptedKeys = asRecord(scheduleData.encryptedKeys);
  const migrationEncryptedKeys = asRecord(scheduleData.migrationEncryptedKeys);
  const visibleTo = new Set<string>();
  const pendingUserIds = new Set<string>();
  const encryptedKeyUpdates: Record<string, ScheduleEncryptedKey> = {};

  const migrationSecret = migrationSecretValue
    ? parseMigrationPrivateKeySecret(migrationSecretValue)
    : null;
  const migrationEncryptedKey = migrationSecret
    ? asScheduleEncryptedKey(migrationEncryptedKeys[migrationSecret.keyId])
    : null;

  for (const userId of intendedVisibleTo) {
    if (encryptedKeys[userId]) {
      visibleTo.add(userId);
      continue;
    }

    const publicKey = await getUserPublicKey(userId, publicKeyCache);
    if (publicKey && migrationSecret && migrationEncryptedKey) {
      encryptedKeyUpdates[`encryptedKeys.${userId}`] =
        rewrapMigrationEncryptedScheduleKey({
          migrationEncryptedKey,
          migrationPrivateKey: migrationSecret.privateKey,
          recipientPublicKey: publicKey.publicKey,
          recipientKeyVersion: publicKey.keyVersion,
        });
      visibleTo.add(userId);
      continue;
    }

    pendingUserIds.add(userId);
  }

  const updateData: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    visibleTo: Array.from(visibleTo),
    ...encryptedKeyUpdates,
  };

  if (pendingUserIds.size > 0 && migrationSecret) {
    updateData.pendingEncryptedRecipientIds = Array.from(pendingUserIds);
    updateData.pendingEncryptedRecipients = Object.fromEntries(
      Array.from(pendingUserIds).map((userId) => [
        userId,
        {
          reason: "missingPublicKey",
          migrationKeyId: migrationSecret.keyId,
          sharedListIds: asStringArray(scheduleData.sharedLists),
        },
      ])
    );
  } else {
    updateData.pendingEncryptedRecipientIds =
      admin.firestore.FieldValue.delete();
    updateData.pendingEncryptedRecipients = admin.firestore.FieldValue.delete();
  }

  return updateData;
}

async function getUserPublicKey(
  userId: string,
  cache: PublicKeyCache
): Promise<UserPublicKey | null> {
  if (cache.has(userId)) {
    return cache.get(userId) || null;
  }

  const doc = await admin
    .firestore()
    .collection("users")
    .doc(userId)
    .collection("encryption")
    .doc("current")
    .get();
  const data = doc.exists ? doc.data() || {} : {};
  const publicKey =
    typeof data.publicKey === "string" ? data.publicKey : "";
  const value = publicKey
    ? {
      publicKey,
      keyVersion: typeof data.keyVersion === "number" ? data.keyVersion : 1,
    }
    : null;
  cache.set(userId, value);
  return value;
}

function readMigrationSecretValue(): string {
  try {
    return scheduleMigrationPrivateKey.value();
  } catch (error) {
    console.warn("Schedule migration secret is unavailable:", error);
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asScheduleEncryptedKey(value: unknown): ScheduleEncryptedKey | null {
  const data = asRecord(value);
  const encryptedScheduleKey = stringValue(data.encryptedScheduleKey);
  const nonce = stringValue(data.nonce);
  const mac = stringValue(data.mac);
  const ephemeralPublicKey = stringValue(data.ephemeralPublicKey);
  if (!encryptedScheduleKey || !nonce || !mac || !ephemeralPublicKey) {
    return null;
  }
  return {
    encryptedScheduleKey,
    nonce,
    mac,
    ephemeralPublicKey,
    algorithm: stringValue(data.algorithm) || "X25519+AES-GCM",
    keyVersion: typeof data.keyVersion === "number" ? data.keyVersion : 1,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 2つの配列が等しいかどうかを判定するヘルパー関数
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
}
