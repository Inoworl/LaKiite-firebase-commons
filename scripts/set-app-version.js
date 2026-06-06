#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function requireFirebaseAdmin() {
  try {
    return require('../functions/node_modules/firebase-admin');
  } catch (error) {
    throw new Error(
      'firebase-admin が見つかりません。先に `npm --prefix functions ci` を実行してください。'
    );
  }
}

function usage() {
  console.log(`Usage:
  node scripts/set-app-version.js <dev|prod> [--apply]

Environment overrides:
  APP_VERSION
  IOS_LATEST_VERSION
  ANDROID_LATEST_VERSION
  IOS_MIN_REQUIRED_VERSION
  ANDROID_MIN_REQUIRED_VERSION
  APP_STORE_URL
  GOOGLE_PLAY_URL
  FORCE_UPDATE
  APP_UPDATE_TITLE
  APP_UPDATE_CONTENT

Examples:
  node scripts/set-app-version.js dev
  node scripts/set-app-version.js dev --apply
  APP_VERSION=1.0.1 node scripts/set-app-version.js prod --apply
`);
}

function readProjectId(alias) {
  const firebaseRcPath = path.join(__dirname, '..', '.firebaserc');
  const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, 'utf8'));
  return firebaseRc.projects?.[alias] ?? alias;
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value == null || value === '') {
    return defaultValue;
  }
  return value === 'true';
}

function buildSettings() {
  const appVersion = process.env.APP_VERSION || '1.0.0';

  return {
    forceUpdate: envBool('FORCE_UPDATE', false),
    iOSLatestVersion: process.env.IOS_LATEST_VERSION || appVersion,
    androidLatestVersion: process.env.ANDROID_LATEST_VERSION || appVersion,
    iOSMinRequiredVersion:
      process.env.IOS_MIN_REQUIRED_VERSION || appVersion,
    androidMinRequiredVersion:
      process.env.ANDROID_MIN_REQUIRED_VERSION || appVersion,
    appStoreUrl: process.env.APP_STORE_URL || '',
    googlePlayUrl: process.env.GOOGLE_PLAY_URL || '',
    title: process.env.APP_UPDATE_TITLE || 'アプリの更新',
    content:
      process.env.APP_UPDATE_CONTENT ||
      '最新バージョンへ更新してください。',
  };
}

async function main() {
  const target = process.argv[2];
  const shouldApply = process.argv.includes('--apply');

  if (!target || target === '--help' || target === '-h') {
    usage();
    process.exit(target ? 0 : 1);
  }

  const projectId = readProjectId(target);
  const settings = buildSettings();

  console.log(`Project: ${projectId}`);
  console.log('Documents: settings/appVersion, settings/appVersionV2');
  console.log(JSON.stringify(settings, null, 2));

  if (!shouldApply) {
    console.log('dry-run: Firestore には書き込んでいません。実行するには --apply を付けてください。');
    return;
  }

  const admin = requireFirebaseAdmin();
  admin.initializeApp({projectId});
  const batch = admin.firestore().batch();
  batch.set(admin.firestore().doc('settings/appVersion'), settings, {merge: true});
  batch.set(admin.firestore().doc('settings/appVersionV2'), settings, {merge: true});
  await batch.commit();
  console.log('settings/appVersion と settings/appVersionV2 を更新しました。');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
