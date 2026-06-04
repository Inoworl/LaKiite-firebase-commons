import * as functions from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import {
  createDefaultScheduleDigestSettingsIfMissing,
  getJstHour,
  getTodayScheduleRangeIso,
  isMorningNotifyHour,
  shouldSendScheduleDigest,
} from "./utils";

interface DigestTarget {
  userId: string;
  tokens: string[];
  count: number;
}

export const sendMorningScheduleDigest = functions.onSchedule(
  {
    schedule: "0 0-9 * * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const notifyHour = getJstHour();
    if (!isMorningNotifyHour(notifyHour)) {
      console.log(`朝通知対象外の時刻です: notifyHour=${notifyHour}`);
      return;
    }

    const range = getTodayScheduleRangeIso();
    const settingsSnapshot = await admin
      .firestore()
      .collection("scheduleDigestSettings")
      .where("enabled", "==", true)
      .where("notifyHour", "==", notifyHour)
      .get();

    if (settingsSnapshot.empty) {
      console.log(`朝通知対象ユーザーなし: notifyHour=${notifyHour}`);
      return;
    }

    const targets: DigestTarget[] = [];
    let skippedAlreadySent = 0;
    let skippedNoSchedules = 0;

    for (const settingsDoc of settingsSnapshot.docs) {
      const settings = settingsDoc.data();
      const userId = settingsDoc.id;

      if (settings.lastSentDate === range.today) {
        skippedAlreadySent++;
        continue;
      }

      const count = await countVisibleSchedulesForToday(userId, range);
      if (!shouldSendScheduleDigest(count)) {
        skippedNoSchedules++;
        await markDigestProcessed(settingsDoc.ref, range.today);
        continue;
      }

      const tokens = await getUserFcmTokens(userId);
      if (tokens.length === 0) {
        await markDigestProcessed(settingsDoc.ref, range.today);
        continue;
      }

      targets.push({userId, tokens, count});
    }

    for (const target of targets) {
      await sendDigestToTarget(target, range.today);
      await markDigestProcessed(
        admin.firestore().collection("scheduleDigestSettings").doc(target.userId),
        range.today
      );
    }

    console.log(
      `朝通知完了: notifyHour=${notifyHour}, sent=${targets.length}, ` +
        `alreadySent=${skippedAlreadySent}, noSchedules=${skippedNoSchedules}`
    );
  }
);

export async function onScheduleDigestUserCreated(userId: string): Promise<void> {
  await createDefaultScheduleDigestSettingsIfMissing(userId);
}

async function countVisibleSchedulesForToday(
  userId: string,
  range: { startInclusiveIso: string; endExclusiveIso: string }
): Promise<number> {
  const snapshot = await admin
    .firestore()
    .collection("schedules")
    .where("visibleTo", "array-contains", userId)
    .where("startDateTime", "<", range.endExclusiveIso)
    .where("endDateTime", ">=", range.startInclusiveIso)
    .count()
    .get();

  return snapshot.data().count;
}

async function getUserFcmTokens(userId: string): Promise<string[]> {
  const userDoc = await admin.firestore().collection("users").doc(userId).get();
  const rawTokens = userDoc.data()?.fcmTokens;
  if (!Array.isArray(rawTokens)) {
    return [];
  }

  return [...new Set(rawTokens.filter((token): token is string => {
    return typeof token === "string" && token.length > 0;
  }))];
}

async function sendDigestToTarget(target: DigestTarget, today: string): Promise<void> {
  const messages = target.tokens.map((token) => ({
    token,
    notification: {
      title: "今日の共有予定",
      body: `今日あなたに共有されている予定が${target.count}件あります`,
    },
    data: {
      type: "schedule_digest",
      date: today,
      scheduleCount: String(target.count),
      timestamp: Date.now().toString(),
    },
    android: {
      notification: {
        icon: "notification_icon",
        color: "#ffa600",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },
    apns: {
      payload: {
        aps: {
          badge: 1,
          sound: "default",
        },
      },
    },
  }));

  const response = await admin.messaging().sendEach(messages);
  response.responses.forEach((sendResponse, index) => {
    if (!sendResponse.success) {
      console.error(
        `朝通知送信失敗: userId=${target.userId}, tokenIndex=${index}`,
        sendResponse.error
      );
    }
  });
}

async function markDigestProcessed(
  ref: admin.firestore.DocumentReference,
  today: string
): Promise<void> {
  await ref.set(
    {
      lastSentDate: today,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true}
  );
}
