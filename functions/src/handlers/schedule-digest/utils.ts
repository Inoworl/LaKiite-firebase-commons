import * as admin from "firebase-admin";

export interface ScheduleDigestSettingsData {
  enabled: boolean;
  notifyHour: number;
  lastSentDate: string | null;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

export function buildDefaultScheduleDigestSettings(): ScheduleDigestSettingsData {
  return {
    enabled: true,
    notifyHour: 8,
    lastSentDate: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export function isMorningNotifyHour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 9;
}

export function shouldSendScheduleDigest(sharedScheduleCount: number): boolean {
  return sharedScheduleCount > 0;
}

export async function createDefaultScheduleDigestSettingsIfMissing(
  userId: string
): Promise<boolean> {
  const ref = admin.firestore().collection("scheduleDigestSettings").doc(userId);
  const snapshot = await ref.get();
  if (snapshot.exists) {
    return false;
  }

  await ref.set(buildDefaultScheduleDigestSettings());
  return true;
}

export async function backfillAllScheduleDigestSettings(): Promise<{
  scanned: number;
  created: number;
  skipped: number;
}> {
  const db = admin.firestore();
  const usersSnapshot = await db.collection("users").get();
  let batch = db.batch();
  let batchCount = 0;
  let created = 0;
  let skipped = 0;

  for (const userDoc of usersSnapshot.docs) {
    const settingsRef = db.collection("scheduleDigestSettings").doc(userDoc.id);
    const settingsSnapshot = await settingsRef.get();
    if (settingsSnapshot.exists) {
      skipped++;
      continue;
    }

    batch.set(settingsRef, buildDefaultScheduleDigestSettings());
    batchCount++;
    created++;

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
    scanned: usersSnapshot.size,
    created,
    skipped,
  };
}

export function getJstDateString(date = new Date()): string {
  const parts = getJstDateParts(date);
  return formatDateParts(parts);
}

export function getJstHour(date = new Date()): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(date));
}

export function getTodayScheduleRangeIso(date = new Date()): {
  today: string;
  startInclusiveIso: string;
  endExclusiveIso: string;
} {
  const parts = getJstDateParts(date);
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const tomorrowParts = getJstDateParts(tomorrow);
  const today = formatDateParts(parts);
  const nextDay = formatDateParts(tomorrowParts);

  return {
    today,
    startInclusiveIso: `${today}T00:00:00.000`,
    endExclusiveIso: `${nextDay}T00:00:00.000`,
  };
}

function getJstDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function formatDateParts(parts: { year: number; month: number; day: number }): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}
