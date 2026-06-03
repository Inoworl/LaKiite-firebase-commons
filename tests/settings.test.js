const {
  setupTestEnvironment,
  teardownTestEnvironment,
  expectSuccess,
  expectFailure
} = require('./helpers');

describe('Settings Collection Security Rules', () => {
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

  describe('appVersion', () => {
    test('未認証ユーザーはappVersionを読み取れる', async () => {
      const context = await setupTestEnvironment(null, {
        'settings/appVersion': appVersionSettings()
      });
      const db = context.firestore();

      await expectSuccess(db.doc('settings/appVersion').get());
    });

    test('未認証ユーザーはappVersion以外のsettingsを読み取れない', async () => {
      const context = await setupTestEnvironment(null, {
        'settings/privateConfig': { value: 'secret' }
      });
      const db = context.firestore();

      await expectFailure(db.doc('settings/privateConfig').get());
    });

    test('一般ユーザーはappVersionを書き込めない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectFailure(
        db.doc('settings/appVersion').set(appVersionSettings())
      );
    });

    test('管理者はappVersionを書き込める', async () => {
      const context = await setupTestEnvironment({
        uid: 'admin1',
        admin: true
      });
      const db = context.firestore();

      await expectSuccess(
        db.doc('settings/appVersion').set(appVersionSettings())
      );
    });

    test('管理者でも必須フィールドが不足しているappVersionは書き込めない', async () => {
      const context = await setupTestEnvironment({
        uid: 'admin1',
        admin: true
      });
      const db = context.firestore();
      const invalidSettings = appVersionSettings();
      delete invalidSettings.androidMinRequiredVersion;

      await expectFailure(
        db.doc('settings/appVersion').set(invalidSettings)
      );
    });
  });

  describe('scheduleDigestSettings', () => {
    test('ユーザーは自分の朝通知設定を読み取れる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' }, {
        'scheduleDigestSettings/user1': scheduleDigestSettings()
      });
      const db = context.firestore();

      await expectSuccess(db.doc('scheduleDigestSettings/user1').get());
    });

    test('ユーザーは他人の朝通知設定を読み取れない', async () => {
      const context = await setupTestEnvironment({ uid: 'user2' }, {
        'scheduleDigestSettings/user1': scheduleDigestSettings()
      });
      const db = context.firestore();

      await expectFailure(db.doc('scheduleDigestSettings/user1').get());
    });

    test('ユーザーは自分の朝通知設定を作成できる', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();

      await expectSuccess(
        db.doc('scheduleDigestSettings/user1').set(scheduleDigestSettings())
      );
    });

    test('10時以降の朝通知設定は作成できない', async () => {
      const context = await setupTestEnvironment({ uid: 'user1' });
      const db = context.firestore();
      const data = scheduleDigestSettings();
      data.notifyHour = 10;

      await expectFailure(
        db.doc('scheduleDigestSettings/user1').set(data)
      );
    });
  });
});

function appVersionSettings() {
  return {
    forceUpdate: false,
    iOSLatestVersion: '1.0.0',
    androidLatestVersion: '1.0.0',
    iOSMinRequiredVersion: '1.0.0',
    androidMinRequiredVersion: '1.0.0',
    appStoreUrl: '',
    googlePlayUrl: '',
    title: 'アプリの更新',
    content: '最新バージョンへ更新してください。'
  };
}

function scheduleDigestSettings() {
  return {
    enabled: true,
    notifyHour: 8,
    lastSentDate: null,
    updatedAt: new Date()
  };
}
