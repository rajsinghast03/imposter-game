// Run via: npm run seed
//
// Syncs Firestore's `categories` collection to SEED_CATEGORIES
// (src/game/seed-data.ts), which is the single source of truth:
//   - each category is written to a STABLE doc id derived from its name
//     (e.g. "Famous People" -> categories/famous-people), so re-seeding keeps
//     players' saved category selections working
//   - existing categories are overwritten in place (word edits/removals apply)
//   - categories no longer in seed-data.ts are deleted from Firestore
//
// Uses the Firebase Admin SDK, which authenticates with a service account and
// BYPASSES Firestore security rules (rules only apply to browser/client SDKs).
//
// Setup (one time):
//   Firebase console → Project settings → Service accounts →
//   "Generate new private key" → save the file as ./serviceAccount.json
//   (it is gitignored — NEVER commit it; it grants full access to your project).
//
// Flags:
//   --dry-run   validate and print what would change, without writing
import { readFileSync } from 'node:fs';
import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { SEED_CATEGORIES, categorySlug } from '../game/seed-data';

const DRY_RUN = process.argv.includes('--dry-run');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? './serviceAccount.json';

// ---- Validation: catch bad data before it reaches players ----
function validate(): string[] {
  const errors: string[] = [];
  const seenIds = new Map<string, string>();

  for (const cat of SEED_CATEGORIES) {
    const id = categorySlug(cat.name);
    const where = `"${cat.name}"`;

    if (!id) errors.push(`${where}: name produces an empty id`);
    if (cat.name.length < 1 || cat.name.length > 40) errors.push(`${where}: name must be 1–40 chars`);
    if (seenIds.has(id)) errors.push(`${where}: same id "${id}" as "${seenIds.get(id)}" — rename one`);
    seenIds.set(id, cat.name);
    if (!cat.emoji) errors.push(`${where}: missing emoji`);
    if (cat.entries.length < 1) errors.push(`${where}: has no entries`);

    const seenWords = new Set<string>();
    for (const e of cat.entries) {
      const word = e.word.trim();
      const key = word.toLowerCase();
      if (!word) errors.push(`${where}: an entry has an empty word`);
      if (!e.hint.trim()) errors.push(`${where}: "${word}" has an empty hint`);
      if (e.hint.trim().toLowerCase() === key) errors.push(`${where}: "${word}" hint gives away the word`);
      if (seenWords.has(key)) errors.push(`${where}: duplicate word "${word}"`);
      seenWords.add(key);
    }
  }
  return errors;
}

const errors = validate();
if (errors.length) {
  console.error(`Seed data has ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

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
  const existing = await col.get();
  const existingIds = new Set(existing.docs.map((d) => d.id));
  const wantedIds = new Set(SEED_CATEGORIES.map((c) => categorySlug(c.name)));

  const batch = db.batch();

  for (const cat of SEED_CATEGORIES) {
    const id = categorySlug(cat.name);
    const isNew = !existingIds.has(id);
    batch.set(col.doc(id), {
      ...cat,
      // keep the original createdAt on updates; set it on first write
      ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { mergeFields: Object.keys(cat).concat(isNew ? ['createdAt', 'updatedAt'] : ['updatedAt']) });
    console.log(`${isNew ? 'ADD   ' : 'UPDATE'} ${id}  (${cat.entries.length} words)`);
  }

  for (const d of existing.docs) {
    if (!wantedIds.has(d.id)) {
      batch.delete(d.ref);
      console.log(`DELETE ${d.id}  (${d.get('name') ?? 'unnamed'})`);
    }
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing written.');
    return;
  }
  await batch.commit();
  console.log(`\nDone! ${SEED_CATEGORIES.length} categories in Firestore.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
