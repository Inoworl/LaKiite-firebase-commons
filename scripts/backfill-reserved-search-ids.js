#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const searchIdPattern = /^[a-zA-Z0-9]{8}$/;

function requireFirebaseAdmin() {
  try {
    return require('../functions/node_modules/firebase-admin');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    throw new Error(
      'firebase-admin が見つかりません。先に `npm --prefix functions ci` を実行してください。'
    );
  }
}

function usage() {
  console.log(`Usage:
  node scripts/backfill-reserved-search-ids.js <dev|prod> [--apply]

Examples:
  node scripts/backfill-reserved-search-ids.js dev
  node scripts/backfill-reserved-search-ids.js dev --apply
`);
}

function readProjectId(alias) {
  const firebaseRcPath = path.join(__dirname, '..', '.firebaserc');
  const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, 'utf8'));
  return firebaseRc.projects?.[alias] ?? alias;
}

function parseArgs(argv) {
  const target = argv[2];
  const shouldApply = argv.includes('--apply');

  if (!target || target === '--help' || target === '-h') {
    usage();
    process.exit(target ? 0 : 1);
  }

  return {target, shouldApply};
}

async function collectBackfillPlan(db) {
  const usersSnapshot = await db.collection('users').get();
  const seenSearchIds = new Map();
  const creates = [];
  const skips = [];
  const conflicts = [];
  const invalidUsers = [];

  for (const userDoc of usersSnapshot.docs) {
    const searchId = userDoc.get('searchId');
    if (typeof searchId !== 'string' || !searchIdPattern.test(searchId)) {
      invalidUsers.push({
        uid: userDoc.id,
        searchId,
      });
      continue;
    }

    const existingOwnerUid = seenSearchIds.get(searchId);
    if (existingOwnerUid && existingOwnerUid !== userDoc.id) {
      conflicts.push({
        searchId,
        existingOwnerUid,
        uid: userDoc.id,
        reason: 'duplicate-users-searchId',
      });
      continue;
    }
    seenSearchIds.set(searchId, userDoc.id);

    const reservationRef = db.collection('reservedSearchIds').doc(searchId);
    const reservationSnapshot = await reservationRef.get();
    if (reservationSnapshot.exists) {
      const reservation = reservationSnapshot.data() ?? {};
      if (
        reservation.ownerUid !== userDoc.id ||
        reservation.searchId !== searchId
      ) {
        conflicts.push({
          searchId,
          existingOwnerUid: reservation.ownerUid,
          uid: userDoc.id,
          reason: 'reservation-owner-mismatch',
        });
        continue;
      }

      skips.push({uid: userDoc.id, searchId});
      continue;
    }

    creates.push({
      ref: reservationRef,
      data: {
        ownerUid: userDoc.id,
        searchId,
        source: 'backfill',
        reservedAt: new Date(),
      },
    });
  }

  return {
    userCount: usersSnapshot.size,
    creates,
    skips,
    conflicts,
    invalidUsers,
  };
}

async function commitCreates(db, creates) {
  const batchSize = 400;
  for (let index = 0; index < creates.length; index += batchSize) {
    const batch = db.batch();
    for (const create of creates.slice(index, index + batchSize)) {
      batch.set(create.ref, create.data, {merge: false});
    }
    await batch.commit();
  }
}

async function main() {
  const {target, shouldApply} = parseArgs(process.argv);
  const projectId = readProjectId(target);

  console.log(`Project: ${projectId}`);
  console.log('Collection: reservedSearchIds');
  console.log(`Mode: ${shouldApply ? 'apply' : 'dry-run'}`);

  const admin = requireFirebaseAdmin();
  admin.initializeApp({projectId});
  const db = admin.firestore();
  const plan = await collectBackfillPlan(db);

  console.log(JSON.stringify({
    users: plan.userCount,
    create: plan.creates.length,
    skipExisting: plan.skips.length,
    conflicts: plan.conflicts,
    invalidUsers: plan.invalidUsers,
  }, null, 2));

  if (plan.conflicts.length > 0 || plan.invalidUsers.length > 0) {
    throw new Error('conflict または invalid user があるため中止しました。');
  }

  if (!shouldApply) {
    console.log('dry-run: Firestore には書き込んでいません。実行するには --apply を付けてください。');
    return;
  }

  await commitCreates(db, plan.creates);
  console.log(`reservedSearchIds を ${plan.creates.length} 件作成しました。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
