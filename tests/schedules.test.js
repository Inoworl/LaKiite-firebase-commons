const {
  setupTestEnvironment,
  teardownTestEnvironment,
  expectSuccess,
  expectFailure
} = require('./helpers');

describe('Schedules Collection Security Rules', () => {
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
    test('スケジュールの所有者は自分のスケジュールを読み取れる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          description: 'Test Description',
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: [],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user1' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(db.doc('schedules/schedule1').get());
    });

    test('visibleToに含まれるユーザーはスケジュールを読み取れる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          description: 'Test Description',
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: ['user2'],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(db.doc('schedules/schedule1').get());
    });

    test('権限のないユーザーはスケジュールを読み取れない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          description: 'Test Description',
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: [],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user3' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(db.doc('schedules/schedule1').get());
    });
  });

  describe('書き込み権限', () => {
    test('認証済みユーザーはスケジュールを作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const scheduleData = {
        title: 'New Schedule',
        description: 'New Description',
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectSuccess(db.doc('schedules/newSchedule').set(scheduleData));
    });

    test('認証済みユーザーは暗号化済みスケジュールを作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const scheduleData = {
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        encrypted: true,
        encryptionVersion: 1,
        encryptedPayload: {
          cipherText: 'payload-cipher',
          nonce: 'payload-nonce',
          mac: 'payload-mac',
          algorithm: 'AES-GCM'
        },
        encryptedKeys: {
          user1: {
            encryptedScheduleKey: 'key-cipher-1',
            nonce: 'key-nonce-1',
            mac: 'key-mac-1',
            ephemeralPublicKey: 'ephemeral-public-key-1',
            algorithm: 'X25519+AES-GCM',
            keyVersion: 1
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectSuccess(
        db.doc('schedules/encryptedSchedule').set(scheduleData)
      );
    });

    test('認証済みユーザーは自分のリストを指定した暗号化済みスケジュールを作成できる', async () => {
      const context = await setupTestEnvironment(
        { uid: 'user1' },
        {
          'lists/list1': {
            ownerId: 'user1',
            memberIds: ['user2']
          }
        }
      );
      const db = context.firestore();

      const scheduleData = {
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: ['list1'],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        encrypted: true,
        encryptionVersion: 1,
        encryptedPayload: {
          cipherText: 'payload-cipher',
          nonce: 'payload-nonce',
          mac: 'payload-mac',
          algorithm: 'AES-GCM'
        },
        encryptedKeys: {
          user1: {
            encryptedScheduleKey: 'key-cipher-1',
            nonce: 'key-nonce-1',
            mac: 'key-mac-1',
            ephemeralPublicKey: 'ephemeral-public-key-1',
            algorithm: 'X25519+AES-GCM',
            keyVersion: 1
          }
        },
        migrationEncryptedKeys: {
          'schedule-migration-v1': {
            encryptedScheduleKey: 'migration-key-cipher',
            nonce: 'migration-key-nonce',
            mac: 'migration-key-mac',
            ephemeralPublicKey: 'migration-ephemeral-public-key',
            algorithm: 'X25519+AES-GCM',
            keyVersion: 1
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectSuccess(
        db.doc('schedules/encryptedPendingSchedule').set(scheduleData)
      );
    });

    test('スケジュール所有者は複数ユーザー分のencryptedKeysへ更新できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: ['user1'],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          encrypted: true,
          encryptionVersion: 1,
          encryptedPayload: {
            cipherText: 'payload-cipher',
            nonce: 'payload-nonce',
            mac: 'payload-mac',
            algorithm: 'AES-GCM'
          },
          encryptedKeys: {
            user1: {
              encryptedScheduleKey: 'key-cipher-1',
              nonce: 'key-nonce-1',
              mac: 'key-mac-1',
              ephemeralPublicKey: 'ephemeral-public-key-1',
              algorithm: 'X25519+AES-GCM',
              keyVersion: 1
            }
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };
      const context = await setupTestEnvironment({ uid: 'user1' }, mockData);
      const db = context.firestore();

      await expectSuccess(
        db.doc('schedules/schedule1').update({
          encryptedKeys: {
            user1: {
              encryptedScheduleKey: 'key-cipher-1',
              nonce: 'key-nonce-1',
              mac: 'key-mac-1',
              ephemeralPublicKey: 'ephemeral-public-key-1',
              algorithm: 'X25519+AES-GCM',
              keyVersion: 1
            },
            user2: {
              encryptedScheduleKey: 'key-cipher-2',
              nonce: 'key-nonce-2',
              mac: 'key-mac-2',
              ephemeralPublicKey: 'ephemeral-public-key-2',
              algorithm: 'X25519+AES-GCM',
              keyVersion: 1
            }
          }
        })
      );
    });

    test('クライアントはvisibleToに他人を直接追加して作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const scheduleData = {
        title: 'New Schedule',
        description: 'New Description',
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1', 'user2'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectFailure(db.doc('schedules/invalidVisibleTo').set(scheduleData));
    });

    test('他人のリストをsharedListsに指定して作成できない', async () => {
      const context = await setupTestEnvironment(
        { uid: 'user1' },
        {
          'lists/list2': {
            ownerId: 'user2',
            memberIds: ['user1']
          }
        }
      );
      const db = context.firestore();

      const scheduleData = {
        title: 'New Schedule',
        description: 'New Description',
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: ['list2'],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectFailure(db.doc('schedules/invalidSharedList').set(scheduleData));
    });

    test('暗号化済みスケジュールに平文詳細フィールドを混在できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const invalidScheduleData = {
        title: 'Plain title',
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        encrypted: true,
        encryptionVersion: 1,
        encryptedPayload: {
          cipherText: 'payload-cipher',
          nonce: 'payload-nonce',
          mac: 'payload-mac',
          algorithm: 'AES-GCM'
        },
        encryptedKeys: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectFailure(
        db.doc('schedules/invalidEncryptedSchedule').set(invalidScheduleData)
      );
    });

    test('認証済みユーザーは終日スケジュールを作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const scheduleData = {
        title: 'All Day Schedule',
        description: 'Time undecided',
        startDateTime: new Date('2026-06-01T00:00:00.000Z'),
        endDateTime: new Date('2026-06-01T23:59:59.999Z'),
        isAllDay: true,
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectSuccess(db.doc('schedules/allDaySchedule').set(scheduleData));
    });

    test('isAllDayがboolでないスケジュールは作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const invalidScheduleData = {
        title: 'Invalid All Day Schedule',
        description: 'Invalid isAllDay',
        startDateTime: new Date(),
        endDateTime: new Date(),
        isAllDay: 'true',
        ownerId: 'user1',
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectFailure(db.doc('schedules/invalidAllDaySchedule').set(invalidScheduleData));
    });

    test('他人のownerIdでスケジュールを作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      const invalidScheduleData = {
        title: 'New Schedule',
        description: 'New Description',
        startDateTime: new Date(),
        endDateTime: new Date(),
        ownerId: 'user2', // 他人のID
        sharedLists: [],
        visibleTo: ['user1'],
        ownerDisplayName: 'Test User',
        reactionCount: 0,
        commentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expectFailure(db.doc('schedules/newSchedule').set(invalidScheduleData));
    });

    test('スケジュールの所有者は自分のスケジュールを更新できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          description: 'Test Description',
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: ['user1'],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user1' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.doc('schedules/schedule1').update({
          title: 'Updated Schedule',
          updatedAt: new Date()
        })
      );
    });

    test('他人はスケジュールを更新できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          description: 'Test Description',
          startDateTime: new Date(),
          endDateTime: new Date(),
          ownerId: 'user1',
          sharedLists: [],
          visibleTo: [],
          ownerDisplayName: 'Test User',
          reactionCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.doc('schedules/schedule1').update({
          title: 'Updated Schedule'
        })
      );
    });
  });

  describe('リアクション機能', () => {
    test('認証済みユーザーは自分のリアクションを作成できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.doc('schedules/schedule1/reactions/user2').set({
          userId: 'user2',
          type: 'going',
          createdAt: new Date(),
          userDisplayName: 'Test User 2',
          userPhotoUrl: null
        })
      );
    });

    test('不正なリアクション種別では作成できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.doc('schedules/schedule1/reactions/user2').set({
          userId: 'user2',
          type: 'like',
          createdAt: new Date(),
          userDisplayName: 'Test User 2',
          userPhotoUrl: null
        })
      );
    });

    test('他人のユーザーIDでリアクションを作成できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.doc('schedules/schedule1/reactions/user3').set({
          userId: 'user3', // 他人のID
          type: 'going',
          createdAt: new Date(),
          userDisplayName: 'Test User 3',
          userPhotoUrl: null
        })
      );
    });

    test('予定にアクセスできないユーザーはリアクションを作成できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user3' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.doc('schedules/schedule1/reactions/user3').set({
          userId: 'user3',
          type: 'thinking',
          createdAt: new Date(),
          userDisplayName: 'Test User 3',
          userPhotoUrl: null
        })
      );
    });
  });

  describe('コメント機能', () => {
    const encryptedContent = {
      cipherText: 'cipher',
      nonce: 'nonce',
      mac: 'mac',
      algorithm: 'AES-GCM'
    };

    test('認証済みユーザーはコメントを作成できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.collection('schedules/schedule1/comments').add({
          userId: 'user2',
          content: 'Great schedule!',
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false,
          userDisplayName: 'Test User 2',
          userPhotoUrl: null
        })
      );
    });

    test('暗号化済みスケジュールでは暗号化コメントを作成できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          encrypted: true,
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.collection('schedules/schedule1/comments').add({
          userId: 'user2',
          encrypted: true,
          encryptedContent,
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false,
          userDisplayName: 'Test User 2',
          userPhotoUrl: null
        })
      );
    });

    test('暗号化済みスケジュールでは平文コメントを作成できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          encrypted: true,
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.collection('schedules/schedule1/comments').add({
          userId: 'user2',
          content: 'Great schedule!',
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false,
          userDisplayName: 'Test User 2',
          userPhotoUrl: null
        })
      );
    });

    test('コメントの作成者は自分のコメントを更新できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        },
        'schedules/schedule1/comments/comment1': {
          userId: 'user2',
          content: 'Original comment',
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.doc('schedules/schedule1/comments/comment1').update({
          content: 'Updated comment',
          updatedAt: new Date(),
          isEdited: true
        })
      );
    });

    test('暗号化コメントの作成者はencryptedContentを更新できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          encrypted: true,
          ownerId: 'user1',
          visibleTo: ['user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        },
        'schedules/schedule1/comments/comment1': {
          userId: 'user2',
          encrypted: true,
          encryptedContent,
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user2' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.doc('schedules/schedule1/comments/comment1').update({
          encryptedContent: {
            cipherText: 'updated-cipher',
            nonce: 'updated-nonce',
            mac: 'updated-mac',
            algorithm: 'AES-GCM'
          },
          updatedAt: new Date(),
          isEdited: true
        })
      );
    });

    test('スケジュール所有者はre-keyのために暗号化コメント本文を更新できる', async () => {
      const mockData = {
        'schedules/schedule1': {
          encrypted: true,
          ownerId: 'user1',
          visibleTo: ['user1', 'user2'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        },
        'schedules/schedule1/comments/comment1': {
          userId: 'user2',
          encrypted: true,
          encryptedContent,
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user1' },
        mockData
      );

      const db = context.firestore();
      await expectSuccess(
        db.doc('schedules/schedule1/comments/comment1').update({
          encryptedContent: {
            cipherText: 'rekeyed-cipher',
            nonce: 'rekeyed-nonce',
            mac: 'rekeyed-mac',
            algorithm: 'AES-GCM'
          }
        })
      );
    });

    test('他人のコメントは更新できない', async () => {
      const mockData = {
        'schedules/schedule1': {
          title: 'Test Schedule',
          ownerId: 'user1',
          visibleTo: ['user2', 'user3'],
          sharedLists: [],
          reactionCount: 0,
          commentCount: 0
        },
        'schedules/schedule1/comments/comment1': {
          userId: 'user2',
          content: 'Original comment',
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdited: false
        }
      };

      const context = await setupTestEnvironment(
        { uid: 'user3' },
        mockData
      );

      const db = context.firestore();
      await expectFailure(
        db.doc('schedules/schedule1/comments/comment1').update({
          content: 'Malicious update'
        })
      );
    });
  });
});
