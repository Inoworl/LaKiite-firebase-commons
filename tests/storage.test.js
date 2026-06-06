const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const fs = require('fs');

let testEnv;

describe('Storage Security Rules', () => {
  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: `storage-test-${Date.now()}`,
      storage: {
        rules: fs.readFileSync('security_rules/storage/storage.rules', 'utf8'),
        host: process.env.CI ? '127.0.0.1' : 'localhost',
        port: 9199
      }
    });
  });

  afterEach(async () => {
    if (testEnv) {
      await testEnv.cleanup();
      testEnv = null;
    }
  });

  describe('プロフィール画像', () => {
    test('認証済みユーザーは自分のプロフィール画像をアップロードできる', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();

      await assertSucceeds(
        storage.ref('v1/users/icon/user1').putString('image-bytes', 'raw', {
          contentType: 'image/png'
        })
      );
    });

    test('他人のプロフィール画像はアップロードできない', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();

      await assertFails(
        storage.ref('v1/users/icon/user2').putString('image-bytes', 'raw', {
          contentType: 'image/png'
        })
      );
    });

    test('画像以外のファイルはアップロードできない', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();

      await assertFails(
        storage.ref('v1/users/icon/user1').putString('plain-text', 'raw', {
          contentType: 'text/plain'
        })
      );
    });

    test('5MBを超えるプロフィール画像はアップロードできない', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();
      const oversizedPayload = 'a'.repeat(5 * 1024 * 1024 + 1);

      await assertFails(
        storage.ref('v1/users/icon/user1').putString(oversizedPayload, 'raw', {
          contentType: 'image/png'
        })
      );
    });

    test('認証済みユーザーはプロフィール画像を読み取れる', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context
          .storage()
          .ref('v1/users/icon/user1')
          .putString('image-bytes', 'raw', { contentType: 'image/png' });
      });

      const storage = testEnv.authenticatedContext('user2').storage();

      await assertSucceeds(storage.ref('v1/users/icon/user1').getMetadata());
    });

    test('未認証ユーザーはプロフィール画像を読み取れない', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context
          .storage()
          .ref('v1/users/icon/user1')
          .putString('image-bytes', 'raw', { contentType: 'image/png' });
      });

      const storage = testEnv.unauthenticatedContext().storage();

      await assertFails(storage.ref('v1/users/icon/user1').getMetadata());
    });
  });

  describe('リスト画像', () => {
    test('リスト所有者はリスト画像をアップロードできる', async () => {
      const storage = testEnv.authenticatedContext('owner1').storage();

      await assertSucceeds(
        storage.ref('v1/lists/icon/owner1/list1').putString('image-bytes', 'raw', {
          contentType: 'image/png'
        })
      );
    });

    test('他人のリスト画像はアップロードできない', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();

      await assertFails(
        storage.ref('v1/lists/icon/owner1/list1').putString('image-bytes', 'raw', {
          contentType: 'image/png'
        })
      );
    });

    test('画像以外のリスト画像ファイルはアップロードできない', async () => {
      const storage = testEnv.authenticatedContext('owner1').storage();

      await assertFails(
        storage.ref('v1/lists/icon/owner1/list1').putString('plain-text', 'raw', {
          contentType: 'text/plain'
        })
      );
    });

    test('認証済みユーザーはリスト画像を読み取れる', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context
          .storage()
          .ref('v1/lists/icon/owner1/list1')
          .putString('image-bytes', 'raw', { contentType: 'image/png' });
      });

      const storage = testEnv.authenticatedContext('user2').storage();

      await assertSucceeds(storage.ref('v1/lists/icon/owner1/list1').getMetadata());
    });
  });

  describe('未定義パス', () => {
    test('許可されていないパスには書き込めない', async () => {
      const storage = testEnv.authenticatedContext('user1').storage();

      await assertFails(
        storage.ref('unknown/path/image.png').putString('image-bytes', 'raw', {
          contentType: 'image/png'
        })
      );
    });
  });
});
