/**
 * restore-appusers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Restores (or bootstraps) the appUsers collection in the named Firestore
 * database "scalebooks" for project scalebooks-9a629.
 *
 * HOW TO RUN:
 *   1. Download a service account key from:
 *      Firebase Console → Project Settings → Service Accounts → Generate new private key
 *      Save the JSON file as  workscale-finance/serviceAccountKey.json
 *      (It is already listed in .gitignore — do NOT commit it.)
 *
 *   2. Install dependencies (one-time):
 *      cd "/Users/markcanlubo/Downloads/GAS Project/workscale-finance/functions"
 *      npm install
 *
 *   3. Run from the project root:
 *      node restore-appusers.js
 *
 * The script is SAFE to re-run — it skips any email that already has a doc.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const admin  = require('firebase-admin');
const path   = require('path');

// ── Service account ───────────────────────────────────────────────────────────
const serviceAccount = require(path.resolve(__dirname, '..', 'serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Named Firestore database (NOT the default "(default)")
const db = admin.firestore().databaseId
  ? admin.firestore()
  : admin.firestore();
// Override to use the named database "scalebooks"
const { getFirestore } = require('firebase-admin/firestore');
const scalebooksDb = getFirestore('scalebooks');

// ── Users to restore ──────────────────────────────────────────────────────────
// Available roles: Admin | Maker | Verifier | Approver | Poster
// Available modules (for moduleAccess):
//   'Vouchers', 'Approvals', 'Weekly Projections', 'Payment Schedule',
//   'Disbursements', 'Check Registry', 'Journal', 'Bank',
//   'Chart of Accounts', 'Tax', 'Financial Management', 'Fixed Assets',
//   'Billing Book', 'Service Invoices', 'Collections', 'Contacts', 'Settings'
//
// Admin role has full access to all modules — moduleAccess can stay empty {}.
// For non-Admin users, specify moduleAccess like:
//   moduleAccess: { 'Vouchers': ['Maker', 'Verifier'], 'Journal': ['Maker'] }

const USERS = [
  {
    email:        'workscale.finance@gmail.com',
    fullName:     'Christian R. Canlubo',
    workEmail:    '',
    roles:        ['Admin'],
    moduleAccess: {},
    signatureUrl: '',
    inviteStatus: 'active',
  },

  // ── Add more users below (copy-paste the block above) ──────────────────────
  // {
  //   email:        'jane@example.com',
  //   fullName:     'Jane Doe',
  //   workEmail:    '',
  //   roles:        ['Maker', 'Verifier'],
  //   moduleAccess: {
  //     'Vouchers':    ['Maker', 'Verifier'],
  //     'Journal':     ['Maker'],
  //     'Disbursements': ['Maker'],
  //   },
  //   signatureUrl: '',
  //   inviteStatus: 'active',
  // },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const now = admin.firestore.FieldValue.serverTimestamp();
  let created = 0;
  let skipped = 0;

  for (const user of USERS) {
    const email = user.email.trim().toLowerCase();

    // Check for existing doc with this email
    const existing = await scalebooksDb
      .collection('appUsers')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) {
      console.log(`⏭  Skipped (already exists): ${email}`);
      skipped++;
      continue;
    }

    await scalebooksDb.collection('appUsers').add({
      email,
      fullName:     user.fullName || '',
      workEmail:    user.workEmail || '',
      roles:        user.roles || [],
      moduleAccess: user.moduleAccess || {},
      signatureUrl: user.signatureUrl || '',
      inviteStatus: user.inviteStatus || 'active',
      invitedAt:    now,
      createdAt:    now,
      createdBy:    'restore-script',
    });

    console.log(`✅ Created: ${email} [${(user.roles || []).join(', ')}]`);
    created++;
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
