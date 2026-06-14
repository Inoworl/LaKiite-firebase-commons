import { expect } from "chai";
import nacl from "tweetnacl";
import {
  decryptScheduleKey,
  encryptScheduleKeyForPublicKey,
  rewrapMigrationEncryptedScheduleKey,
} from "../handlers/schedule/encryption-migration";

describe("schedule encryption migration", () => {
  it("rewraps a migration encrypted schedule key for a recipient public key", () => {
    const migrationKeyPair = nacl.box.keyPair();
    const recipientKeyPair = nacl.box.keyPair();
    const scheduleKey = nacl.randomBytes(32);

    const migrationEncryptedKey = encryptScheduleKeyForPublicKey({
      scheduleKey,
      recipientPublicKey: Buffer.from(migrationKeyPair.publicKey).toString("base64"),
      keyVersion: 1,
    });

    const recipientEncryptedKey = rewrapMigrationEncryptedScheduleKey({
      migrationEncryptedKey,
      migrationPrivateKey: Buffer.from(migrationKeyPair.secretKey).toString("base64"),
      recipientPublicKey: Buffer.from(recipientKeyPair.publicKey).toString("base64"),
      recipientKeyVersion: 1,
    });

    const decrypted = decryptScheduleKey({
      encryptedKey: recipientEncryptedKey,
      privateKey: Buffer.from(recipientKeyPair.secretKey).toString("base64"),
    });

    expect(Buffer.from(decrypted).equals(Buffer.from(scheduleKey))).to.equal(true);
  });
});
