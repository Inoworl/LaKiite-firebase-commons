import * as admin from "firebase-admin";

interface PrivateProfileSnapshot {
  friends?: unknown;
}

type FriendRemovalCleanupTarget =
  | {
      kind: "friendPrivateProfile";
      userId: string;
      friendId: string;
    }
  | {
      kind: "ownedLists" | "displayLists" | "ownedSchedules";
      ownerId: string;
      memberId: string;
    };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function getRemovedFriendIds(
  before: PrivateProfileSnapshot,
  after: PrivateProfileSnapshot
): string[] {
  const beforeFriendIds = asStringArray(before.friends);
  const afterFriendIds = new Set(asStringArray(after.friends));

  return beforeFriendIds.filter((friendId) => !afterFriendIds.has(friendId));
}

export async function mirrorRemovedFriendReferences(
  userId: string,
  removedFriendIds: string[]
) {
  for (const friendId of removedFriendIds) {
    await applyFriendRemovalCleanupTargets(
      buildFriendRemovalCleanupTargets(userId, friendId)
    );
  }
}

export function buildFriendRemovalCleanupTargets(
  userId: string,
  friendId: string
): FriendRemovalCleanupTarget[] {
  return [
    { kind: "friendPrivateProfile", userId, friendId },
    { kind: "ownedLists", ownerId: userId, memberId: friendId },
    { kind: "ownedLists", ownerId: friendId, memberId: userId },
    { kind: "displayLists", ownerId: userId, memberId: friendId },
    { kind: "displayLists", ownerId: friendId, memberId: userId },
    { kind: "ownedSchedules", ownerId: userId, memberId: friendId },
    { kind: "ownedSchedules", ownerId: friendId, memberId: userId },
  ];
}

async function applyFriendRemovalCleanupTargets(
  targets: FriendRemovalCleanupTarget[]
) {
  await Promise.all(
    targets.map((target) => {
      switch (target.kind) {
      case "friendPrivateProfile":
        return removeFromFriendPrivateProfile(target.userId, target.friendId);
      case "ownedLists":
        return removeMemberFromOwnedLists(target.ownerId, target.memberId);
      case "displayLists":
        return removeMemberFromDisplayLists(target.ownerId, target.memberId);
      case "ownedSchedules":
        return removeMemberFromOwnedSchedules(target.ownerId, target.memberId);
      }
    })
  );
}

async function removeFromFriendPrivateProfile(userId: string, friendId: string) {
  const profileRef = admin
    .firestore()
    .doc(`users/${friendId}/private/profile`);
  const profileDoc = await profileRef.get();
  if (!profileDoc.exists || !asStringArray(profileDoc.data()?.friends).includes(userId)) {
    return;
  }

  await profileRef.update({
    friends: admin.firestore.FieldValue.arrayRemove(userId),
  });
}

async function removeMemberFromOwnedLists(ownerId: string, memberId: string) {
  const snapshot = await admin
    .firestore()
    .collection("lists")
    .where("ownerId", "==", ownerId)
    .get();

  await removeMemberFromListDocs(snapshot.docs, memberId);
}

async function removeMemberFromDisplayLists(ownerId: string, memberId: string) {
  const snapshot = await admin
    .firestore()
    .collection("users")
    .doc(ownerId)
    .collection("displayLists")
    .get();

  await removeMemberFromListDocs(snapshot.docs, memberId);
}

async function removeMemberFromOwnedSchedules(ownerId: string, memberId: string) {
  const snapshot = await admin
    .firestore()
    .collection("schedules")
    .where("ownerId", "==", ownerId)
    .where("visibleTo", "array-contains", memberId)
    .get();

  await removeMemberFromVisibleToDocs(snapshot.docs, memberId);
}

async function removeMemberFromListDocs(
  docs: admin.firestore.QueryDocumentSnapshot[],
  memberId: string
) {
  const targetDocs = docs.filter((doc) => asStringArray(doc.data().memberIds).includes(memberId));
  if (targetDocs.length === 0) {
    return;
  }

  const batch = admin.firestore().batch();
  targetDocs.forEach((doc) => {
    batch.update(doc.ref, {
      memberIds: admin.firestore.FieldValue.arrayRemove(memberId),
    });
  });
  await batch.commit();
}

async function removeMemberFromVisibleToDocs(
  docs: admin.firestore.QueryDocumentSnapshot[],
  memberId: string
) {
  if (docs.length === 0) {
    return;
  }

  const batch = admin.firestore().batch();
  docs.forEach((doc) => {
    batch.update(doc.ref, {
      visibleTo: admin.firestore.FieldValue.arrayRemove(memberId),
    });
  });
  await batch.commit();
}
