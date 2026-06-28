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
      const reservationData = {
        ownerUid: 'user1',
        searchId: 'test1234',
        source: 'client',
        reservedAt: new Date()
      };
      const batch = db.batch();
      batch.set(db.doc('reservedSearchIds/test1234'), reservationData);
      batch.set(db.doc('users/user1'), userData);

      await expectSuccess(batch.commit());
    });

    test('予約されていないsearchIdではプロフィールを作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const userData = {
        displayName: 'Test User',
        searchId: 'test1234'
      };

      await expectFailure(db.doc('users/user1').set(userData));
    });

    test('searchId変更時は新しい予約IDが必要', async () => {
      const mockData = {
        'users/user1': {
          displayName: 'Test User',
          searchId: 'test1234'
        },
        'reservedSearchIds/test1234': {
          ownerUid: 'user1',
          searchId: 'test1234',
          source: 'backfill',
          reservedAt: new Date()
        }
      };
      const context = await setupTestEnvironment({ uid: 'user1' }, mockData);
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1').update({
          displayName: 'Test User',
          searchId: 'next1234'
        })
      );

      const batch = db.batch();
      batch.set(db.doc('reservedSearchIds/next1234'), {
        ownerUid: 'user1',
        searchId: 'next1234',
        source: 'client',
        reservedAt: new Date()
      });
      batch.update(db.doc('users/user1'), {
        displayName: 'Test User',
        searchId: 'next1234'
      });
      await expectSuccess(batch.commit());
    });

    test('他ユーザーが予約済みのsearchIdには変更できない', async () => {
      const mockData = {
        'users/user1': {
          displayName: 'Test User',
          searchId: 'test1234'
        },
        'reservedSearchIds/taken123': {
          ownerUid: 'user2',
          searchId: 'taken123',
          source: 'backfill',
          reservedAt: new Date()
        }
      };
      const context = await setupTestEnvironment({ uid: 'user1' }, mockData);
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1').update({
          displayName: 'Test User',
          searchId: 'taken123'
        })
      );
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

  describe('検索ID予約', () => {
    test('ユーザーは自分のsearchId予約を作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectSuccess(
        db.doc('reservedSearchIds/test1234').set({
          ownerUid: 'user1',
          searchId: 'test1234',
          source: 'client',
          reservedAt: new Date()
        })
      );
    });

    test('ユーザーは他人名義のsearchId予約を作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('reservedSearchIds/test1234').set({
          ownerUid: 'user2',
          searchId: 'test1234',
          source: 'client',
          reservedAt: new Date()
        })
      );
    });

    test('予約済みsearchIdは更新も削除もできない', async () => {
      const mockData = {
        'reservedSearchIds/test1234': {
          ownerUid: 'user1',
          searchId: 'test1234',
          source: 'backfill',
          reservedAt: new Date()
        }
      };
      const context = await setupTestEnvironment({ uid: 'user1' }, mockData);
      const db = context.firestore();

      await expectFailure(
        db.doc('reservedSearchIds/test1234').update({ source: 'client' })
      );
      await expectFailure(db.doc('reservedSearchIds/test1234').delete());
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
    const encryptedPrivateKeyBackup = {
      cipherText: 'encrypted-private-key',
      nonce: 'nonce',
      mac: 'mac',
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-HMAC-SHA256',
      kdfIterations: 210000,
      salt: 'salt',
      keyVersion: 1,
      version: 1
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

    test('ユーザーは自分の暗号化秘密鍵バックアップを保存できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectSuccess(
        db.doc('users/user1/encryption/current').set({
          ...publicKeyData,
          encryptedPrivateKeyBackup
        })
      );
    });

    test('ユーザーは平文秘密鍵バックアップを保存できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('users/user1/encryption/current').set({
          ...publicKeyData,
          encryptedPrivateKeyBackup: {
            privateKey: 'plain-private-key'
          }
        })
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
