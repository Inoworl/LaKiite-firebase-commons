const {
  setupTestEnvironment,
  teardownTestEnvironment,
  expectSuccess,
  expectFailure
} = require('./helpers');

describe('Users Collection Security Rules', () => {
  afterEach(async () => {
    try {
      await teardownTestEnvironment();
    } catch (error) {
      console.warn('Teardown warning:', error.message);
    }
  });

  afterAll(async () => {
    try {
      await teardownTestEnvironment();
    } catch (error) {
      console.warn('Final teardown warning:', error.message);
    }
  });

  describe('読み取り権限', () => {
    test('認証済みユーザーは他のユーザーの公開情報を読み取れる', async () => {
      const mockData = {
        'users/user1': {
          displayName: 'Test User 1',
          searchId: 'test1234'
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(db.doc('users/user1').get());
    });

    test('未認証ユーザーはユーザー情報を読み取れない', async () => {
      const mockData = {
        'users/user1': {
          displayName: 'Test User 1',
          searchId: 'test1234'
        }
      };

      const context = await setupTestEnvironment(null, mockData);
      const db = context.firestore();

      await expectFailure(db.doc('users/user1').get());
    });

    test('searchIdによる検索クエリが許可される', async () => {
      const mockData = {
        'users/user1': {
          displayName: 'Test User 1',
          searchId: 'test1234'
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.collection('users')
          .where('searchId', '==', 'test1234')
          .limit(1)
          .get()
      );
    });
  });

  describe('書き込み権限', () => {
    test('ユーザーは自分のプロフィールを作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const userData = {
        displayName: 'Test User',
        searchId: 'test1234'
      };

      await expectSuccess(db.doc('users/user1').set(userData));
    });

    test('ユーザーは他人のプロフィールを作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const userData = {
        displayName: 'Test User',
        searchId: 'test1234'
      };

      await expectFailure(db.doc('users/user2').set(userData));
    });

    test('必須フィールドが不足している場合は作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const invalidUserData = {
        displayName: 'Test User'
        // searchIdが不足
      };

      await expectFailure(db.doc('users/user1').set(invalidUserData));
    });

    test('無効なsearchIdフォーマットの場合は作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const invalidUserData = {
        displayName: 'Test User',
        searchId: 'invalid-format' // 8文字の英数字でない
      };

      await expectFailure(db.doc('users/user1').set(invalidUserData));
    });
  });

  describe('プライベートサブコレクション', () => {
    test('ユーザーは自分のプライベート情報を読み取れる', async () => {
      const mockData = {
        'users/user1/private/profile': {
          name: 'Real Name',
          friends: ['user2'],
          groups: ['group1'],
          createdAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user1' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(db.doc('users/user1/private/profile').get());
    });

    test('友達はプライベート情報を読み取れる', async () => {
      const mockData = {
        'users/user1/private/profile': {
          name: 'Real Name',
          friends: ['user2'],
          groups: ['group1'],
          createdAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(db.doc('users/user1/private/profile').get());
    });

    test('友達でないユーザーはプライベート情報を読み取れない', async () => {
      const mockData = {
        'users/user1/private/profile': {
          name: 'Real Name',
          friends: ['user2'],
          groups: ['group1'],
          createdAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user3' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(db.doc('users/user1/private/profile').get());
    });
  });

  describe('表示用リストサブコレクション', () => {
    const displayListData = {
      name: '家族',
      ownerId: 'user1',
      colorKey: 'teal',
      memberIds: ['user2'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    test('ユーザーは自分の表示用リストを読み取れる', async () => {
      const mockData = {
        'users/user1/displayLists/list1': displayListData
      };

      const context = await setupTestEnvironment({ uid: 'user1' }, mockData);
      const db = context.firestore();

      await expectSuccess(db.doc('users/user1/displayLists/list1').get());
    });

    test('ユーザーは他人の表示用リストを読み取れない', async () => {
      const mockData = {
        'users/user1/displayLists/list1': displayListData
      };

      const context = await setupTestEnvironment({ uid: 'user2' }, mockData);
      const db = context.firestore();

      await expectFailure(db.doc('users/user1/displayLists/list1').get());
    });

    test('ユーザーは自分の表示用リストを作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectSuccess(
        db.doc('users/user1/displayLists/list1').set(displayListData)
      );
    });

    test('ユーザーは他人の表示用リストを作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user2' });
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1/displayLists/list1').set(displayListData)
      );
    });

    test('無効なカラーキーの表示用リストは作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1/displayLists/list1').set({
          ...displayListData,
          colorKey: 'unknown'
        })
      );
    });
  });

  describe('暗号化公開鍵サブコレクション', () => {
    const publicKeyData = {
      publicKey: 'base64-public-key',
      keyVersion: 1,
      algorithm: 'X25519',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    test('認証済みユーザーは他ユーザーの公開鍵を読み取れる', async () => {
      const mockData = {
        'users/user1/encryption/current': publicKeyData
      };

      const context = await setupTestEnvironment({ uid: 'user2' }, mockData);
      const db = context.firestore();

      await expectSuccess(db.doc('users/user1/encryption/current').get());
    });

    test('ユーザーは自分の公開鍵を作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectSuccess(
        db.doc('users/user1/encryption/current').set(publicKeyData)
      );
    });

    test('ユーザーは他人の公開鍵を作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user2/encryption/current').set(publicKeyData)
      );
    });

    test('current以外の暗号化ドキュメントは作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1/encryption/privateKeyBackups').set(publicKeyData)
      );
    });
  });
});
