// Run via: npm run seed
//
// Uses the Firebase Admin SDK, which authenticates with a service account and
// BYPASSES Firestore security rules (rules only apply to browser/client SDKs).
// That's why this script can write to `categories` even though the rules only
// allow the admin UID to do so from the app.
//
// Setup (one time):
//   Firebase console → Project settings → Service accounts →
//   "Generate new private key" → save the file as ./serviceAccount.json
//   (it is gitignored — NEVER commit it; it grants full access to your project).
import { readFileSync } from 'node:fs';
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SEED_CATEGORIES } from '../game/seed-data';

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? './serviceAccount.json';

let serviceAccount: ServiceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
} catch {
  console.error(
    `Could not read service account key at ${KEY_PATH}.\n` +
      'Download it from Firebase console → Project settings → Service accounts.',
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function seed() {
  const col = db.collection('categories');

  // Wipe existing official categories in one batch, then re-add them.
  const existing = await col.get();
  const wipe = db.batch();
  existing.docs.forEach((d) => wipe.delete(d.ref));
  await wipe.commit();
  console.log(`Cleared ${existing.size} existing categories.`);

  const add = db.batch();
  for (const cat of SEED_CATEGORIES) {
    const ref = col.doc(); // auto-generated id, like addDoc()
    add.set(ref, { ...cat, createdAt: new Date().toISOString() });
    console.log(`Seeding: ${cat.name} (${ref.id})`);
  }
  await add.commit();

  console.log(`Done! Seeded ${SEED_CATEGORIES.length} categories.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
