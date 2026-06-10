import { onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { scheduleMigrationPrivateKey } from "../schedule/encryption-migration";
import { removeDeletedListFromSchedules, updateSchedulesVisibility } from "./utils";

/**
 * リストのメンバーが変更された時に実行されるトリガー
 */
export const onListMemberUpdate = onDocumentUpdated({
  document: "lists/{listId}",
  region: "asia-northeast1",
  secrets: [scheduleMigrationPrivateKey],
}, async (event) => {
  const listId = event.params.listId;
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();

  if (!beforeData || !afterData) {
    console.log("No data found in before or after");
    return;
  }

  console.log(`List ${listId} updated`);

  // メンバーIDの変更を検出
  const beforeMemberIds = new Set((beforeData.memberIds || []) as string[]);
  const afterMemberIds = new Set((afterData.memberIds || []) as string[]);

  // 追加されたメンバー
  const addedMembers = Array.from(afterMemberIds).filter(id => !beforeMemberIds.has(id));

  // 削除されたメンバー
  const removedMembers = Array.from(beforeMemberIds).filter(id => !afterMemberIds.has(id));

  console.log(`Added members: ${addedMembers.join(", ")}`);
  console.log(`Removed members: ${removedMembers.join(", ")}`);

  // メンバー変更がない場合は早期リターン
  if (addedMembers.length === 0 && removedMembers.length === 0) {
    console.log("No member changes detected");
    return;
  }

  try {
    // 関連する予定の可視性を更新
    await updateSchedulesVisibility(listId, addedMembers, removedMembers);
    console.log(`Successfully updated schedules visibility for list ${listId}`);
  } catch (error) {
    console.error(`Error updating schedules visibility for list ${listId}:`, error);
    throw error;
  }
});

/**
 * リストが削除された時に、そのリスト経由の予定公開を解除するトリガー
 */
export const onListDeleted = onDocumentDeleted({
  document: "lists/{listId}",
  region: "asia-northeast1"
}, async (event) => {
  const listId = event.params.listId;

  try {
    await removeDeletedListFromSchedules(listId);
    console.log(`Successfully removed deleted list ${listId} from schedules`);
  } catch (error) {
    console.error(`Error removing deleted list ${listId} from schedules:`, error);
    throw error;
  }
});
