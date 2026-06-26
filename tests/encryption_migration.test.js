const {
  setupTestEnvironment,
  teardownTestEnvironment,
  expectSuccess,
  expectFailure
} = require('./helpers');

describe('Encryption Migration Security Rules', () => {
  afterEach(async () => {
    await teardownTestEnvironment();
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  test('認証済みユーザーは移行用公開鍵を読み取れる', async () => {
    const context = await setupTestEnvironment(
      { uid: 'user1' },
      {
        'encryptionMigration/current': {
          keyId: 'schedule-migration-v1',
          publicKey: 'base64-public-key',
          keyVersion: 1,
          algorithm: 'X25519',
          enabled: true
        }
      }
    );
    const db = context.firestore();

    await expectSuccess(db.doc('encryptionMigration/current').get());
  });

  test('未認証ユーザーは移行用公開鍵を読み取れない', async () => {
    const context = await setupTestEnvironment(null, {
      'encryptionMigration/current': {
        keyId: 'schedule-migration-v1',
        publicKey: 'base64-public-key',
        keyVersion: 1,
        algorithm: 'X25519',
        enabled: true
      }
    });
    const db = context.firestore();

    await expectFailure(db.doc('encryptionMigration/current').get());
  });

  test('クライアントは移行用公開鍵を書き込めない', async () => {
    const context = await setupTestEnvironment({ uid: 'user1' });
    const db = context.firestore();

    await expectFailure(
      db.doc('encryptionMigration/current').set({
        keyId: 'schedule-migration-v1',
        publicKey: 'base64-public-key',
        keyVersion: 1,
        algorithm: 'X25519',
        enabled: true
      })
    );
  });
});
