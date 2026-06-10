import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import nacl from "tweetnacl";

export const scheduleMigrationPrivateKey = defineSecret(
  "SCHEDULE_MIGRATION_PRIVATE_KEY"
);

export type ScheduleEncryptedKey = {
  encryptedScheduleKey: string;
  nonce: string;
  mac: string;
  ephemeralPublicKey: string;
  algorithm: string;
  keyVersion: number;
};

type MigrationPrivateKeySecret = {
  keyId: string;
  privateKey: string;
  publicKey: string;
  keyVersion: number;
};

type EncryptScheduleKeyParams = {
  scheduleKey: Uint8Array;
  recipientPublicKey: string;
  keyVersion: number;
};

type DecryptScheduleKeyParams = {
  encryptedKey: ScheduleEncryptedKey;
  privateKey: string;
};

export function encryptScheduleKeyForPublicKey({
  scheduleKey,
  recipientPublicKey,
  keyVersion,
}: EncryptScheduleKeyParams): ScheduleEncryptedKey {
  const recipientPublicKeyBytes = decodeBase64(recipientPublicKey, 32);
  const ephemeralKeyPair = nacl.box.keyPair();
  const sharedKey = nacl.scalarMult(
    ephemeralKeyPair.secretKey,
    recipientPublicKeyBytes
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(sharedKey), nonce);
  const cipherText = Buffer.concat([
    cipher.update(Buffer.from(scheduleKey)),
    cipher.final(),
  ]);
  const mac = cipher.getAuthTag();

  return {
    encryptedScheduleKey: cipherText.toString("base64"),
    nonce: nonce.toString("base64"),
    mac: mac.toString("base64"),
    ephemeralPublicKey: Buffer.from(ephemeralKeyPair.publicKey).toString("base64"),
    algorithm: "X25519+AES-GCM",
    keyVersion,
  };
}

export function decryptScheduleKey({
  encryptedKey,
  privateKey,
}: DecryptScheduleKeyParams): Uint8Array {
  const privateKeyBytes = decodeBase64(privateKey, 32);
  const ephemeralPublicKey = decodeBase64(encryptedKey.ephemeralPublicKey, 32);
  const sharedKey = nacl.scalarMult(privateKeyBytes, ephemeralPublicKey);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(sharedKey),
    Buffer.from(encryptedKey.nonce, "base64")
  );
  decipher.setAuthTag(Buffer.from(encryptedKey.mac, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedKey.encryptedScheduleKey, "base64")),
    decipher.final(),
  ]);
}

export function rewrapMigrationEncryptedScheduleKey({
  migrationEncryptedKey,
  migrationPrivateKey,
  recipientPublicKey,
  recipientKeyVersion,
}: {
  migrationEncryptedKey: ScheduleEncryptedKey;
  migrationPrivateKey: string;
  recipientPublicKey: string;
  recipientKeyVersion: number;
}): ScheduleEncryptedKey {
  const scheduleKey = decryptScheduleKey({
    encryptedKey: migrationEncryptedKey,
    privateKey: migrationPrivateKey,
  });
  return encryptScheduleKeyForPublicKey({
    scheduleKey,
    recipientPublicKey,
    keyVersion: recipientKeyVersion,
  });
}

export function parseMigrationPrivateKeySecret(
  value: string
): MigrationPrivateKeySecret {
  const parsed = JSON.parse(value) as Partial<MigrationPrivateKeySecret>;
  if (
    typeof parsed.keyId !== "string" ||
    typeof parsed.privateKey !== "string" ||
    typeof parsed.publicKey !== "string"
  ) {
    throw new Error("Invalid schedule migration private key secret");
  }
  return {
    keyId: parsed.keyId,
    privateKey: parsed.privateKey,
    publicKey: parsed.publicKey,
    keyVersion: typeof parsed.keyVersion === "number" ? parsed.keyVersion : 1,
  };
}

export async function grantPendingScheduleAccessForUser({
  userId,
  userPublicKey,
  userKeyVersion,
  migrationPrivateKeySecret,
}: {
  userId: string;
  userPublicKey: string;
  userKeyVersion: number;
  migrationPrivateKeySecret: string;
}): Promise<number> {
  const migrationSecret = parseMigrationPrivateKeySecret(
    migrationPrivateKeySecret
  );
  const db = admin.firestore();
  const snapshot = await db
    .collection("schedules")
    .where("pendingEncryptedRecipientIds", "array-contains", userId)
    .limit(500)
    .get();

  if (snapshot.empty) {
    return 0;
  }

  let updated = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const scheduleDoc of snapshot.docs) {
    const data = scheduleDoc.data();
    if (data.encrypted !== true) {
      continue;
    }

    const pendingRecipients = asRecord(data.pendingEncryptedRecipients);
    const pendingRecipient = asRecord(pendingRecipients[userId]);
    const migrationKeyId = stringValue(pendingRecipient.migrationKeyId);
    const migrationEncryptedKeys = asRecord(data.migrationEncryptedKeys);
    const migrationEncryptedKey = asScheduleEncryptedKey(
      migrationEncryptedKeys[migrationKeyId]
    );
    if (!migrationEncryptedKey || migrationKeyId !== migrationSecret.keyId) {
      console.warn(
        `Cannot grant pending schedule ${scheduleDoc.id} to ${userId}: migration key is missing`
      );
      continue;
    }

    const recipientEncryptedKey = rewrapMigrationEncryptedScheduleKey({
      migrationEncryptedKey,
      migrationPrivateKey: migrationSecret.privateKey,
      recipientPublicKey: userPublicKey,
      recipientKeyVersion: userKeyVersion,
    });

    batch.update(scheduleDoc.ref, {
      [`encryptedKeys.${userId}`]: recipientEncryptedKey,
      [`pendingEncryptedRecipients.${userId}`]:
        admin.firestore.FieldValue.delete(),
      pendingEncryptedRecipientIds:
        admin.firestore.FieldValue.arrayRemove(userId),
      visibleTo: admin.firestore.FieldValue.arrayUnion(userId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batchCount++;
    updated++;

    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return updated;
}

export const onUserEncryptionKeyWritten = functions.onDocumentWritten(
  {
    document: "users/{userId}/encryption/current",
    region: "asia-northeast1",
    secrets: [scheduleMigrationPrivateKey],
    timeoutSeconds: 540,
  },
  async (event) => {
    const userId = event.params.userId;
    const data = event.data?.after.data();
    if (!data) {
      return;
    }

    const publicKey = stringValue(data.publicKey);
    if (!publicKey) {
      return;
    }

    const updated = await grantPendingScheduleAccessForUser({
      userId,
      userPublicKey: publicKey,
      userKeyVersion: typeof data.keyVersion === "number" ? data.keyVersion : 1,
      migrationPrivateKeySecret: scheduleMigrationPrivateKey.value(),
    });
    console.log(`Granted ${updated} pending encrypted schedules to ${userId}`);
  }
);

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodeBase64(value: string, expectedLength: number): Uint8Array {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}
