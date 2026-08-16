#!/usr/bin/env node
/**
 * Data-migration runner.
 *
 * Scripts live in ./scripts and run in filename order. Each applied script is
 * recorded in the `_migrations` collection so it never runs twice. Connection
 * details come from the same root .env everything else uses.
 *
 *   npm run migrate          apply everything outstanding
 *   npm run migrate:status   show what has and has not run
 *   npm run down             roll back the most recent script
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, 'migrations');
const COLLECTION = '_migrations';

const { default: config } = await import('../src/config/env.js');
const { connectDatabase, disconnectDatabase } = await import('../src/config/db.js');
const mongoose = (await import('mongoose')).default;

async function listScripts() {
  const files = await fs.readdir(SCRIPTS_DIR).catch(() => []);
  return files.filter((f) => f.endsWith('.js')).sort();
}

async function appliedNames(db) {
  const rows = await db.collection(COLLECTION).find({}).sort({ appliedAt: 1 }).toArray();
  return rows.map((row) => row.name);
}

async function run() {
  const command = process.argv[2] ?? 'up';

  await connectDatabase();
  const { db } = mongoose.connection;

  const scripts = await listScripts();
  const applied = await appliedNames(db);

  if (command === 'status') {
    console.log(`\nMigrations in ${config.db.name}\n`);
    if (scripts.length === 0) console.log('  (none found)');
    for (const name of scripts) {
      console.log(`  ${applied.includes(name) ? '✓ applied ' : '· pending '} ${name}`);
    }
    console.log('');
  } else if (command === 'up') {
    const pending = scripts.filter((name) => !applied.includes(name));
    if (pending.length === 0) {
      console.log('Nothing to apply — the database is up to date.');
    }
    for (const name of pending) {
      const migration = await import(path.join(SCRIPTS_DIR, name));
      console.log(`→ applying ${name}`);
      await migration.up({ db, mongoose, config });
      await db.collection(COLLECTION).insertOne({ name, appliedAt: new Date() });
      console.log(`✓ applied  ${name}`);
    }
  } else if (command === 'down') {
    const last = applied.at(-1);
    if (!last) {
      console.log('Nothing to roll back.');
    } else {
      const migration = await import(path.join(SCRIPTS_DIR, last));
      if (typeof migration.down !== 'function') {
        throw new Error(`${last} does not define a down() function, so it cannot be rolled back.`);
      }
      console.log(`→ rolling back ${last}`);
      await migration.down({ db, mongoose, config });
      await db.collection(COLLECTION).deleteOne({ name: last });
      console.log(`✓ rolled back  ${last}`);
    }
  } else {
    console.error(`Unknown command "${command}". Use: up | down | status`);
    process.exitCode = 1;
  }

  await disconnectDatabase();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
