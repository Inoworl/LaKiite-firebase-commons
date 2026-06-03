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
