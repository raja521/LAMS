#!/usr/bin/env node
/**
 * Create the first administrator so someone can sign in to a fresh install.
 *
 * The account details come from the environment — there is no default email and
 * no default password anywhere in this file. Running it twice is safe: an
 * existing account is left alone.
 *
 *   SEED_ADMIN_EMAIL=you@district.gov SEED_ADMIN_PASSWORD='...' npm run seed
 */
import process from 'node:process';

const { default: config } = await import('../server/src/config/env.js');
const { connectDatabase, disconnectDatabase } = await import('../server/src/config/db.js');
const { Organization, User } = await import('../server/src/models/index.js');

const REQUIRED = ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_FIRST_NAME', 'SEED_ADMIN_LAST_NAME'];
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(
    `\nCannot seed the first administrator: missing environment variable(s): ${missing.join(', ')}.\n\n` +
      'Set them in .env or pass them inline, for example:\n' +
      "  SEED_ADMIN_EMAIL=you@district.gov SEED_ADMIN_PASSWORD='a-long-passphrase' \\\n" +
      "  SEED_ADMIN_FIRST_NAME=Ada SEED_ADMIN_LAST_NAME=Lovelace npm run seed\n\n" +
      'No default account is created by design.\n'
  );
  process.exit(1);
}

const password = process.env.SEED_ADMIN_PASSWORD.trim();
if (password.length < 12) {
  console.error('\nSEED_ADMIN_PASSWORD must be at least 12 characters long.\n');
  process.exit(1);
}

await connectDatabase();

const email = process.env.SEED_ADMIN_EMAIL.trim().toLowerCase();
const existing = await User.findOne({ email });

if (existing) {
  console.log(`An account already exists for ${email} — leaving it untouched.`);
} else {
  let organization = null;
  const orgName = process.env.SEED_ORG_NAME?.trim();
  if (orgName) {
    organization = await Organization.findOneAndUpdate(
      { name: orgName },
      { $setOnInsert: { name: orgName, type: 'district', isActive: true } },
      { new: true, upsert: true }
    );
  }

  const admin = new User({
    firstName: process.env.SEED_ADMIN_FIRST_NAME.trim(),
    lastName: process.env.SEED_ADMIN_LAST_NAME.trim(),
    email,
    role: 'admin',
    authProvider: 'local',
    organization: organization?._id,
    isActive: true,
  });
  await admin.setPassword(password);
  await admin.save();

  console.log(`Created administrator ${email} in ${config.db.name}.`);
}

await disconnectDatabase();
