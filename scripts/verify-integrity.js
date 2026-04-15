#!/usr/bin/env node
/**
 * scripts/verify-integrity.js
 *
 * Data integrity verification script.
 * Run after migrations or before going live to catch data issues early.
 *
 * Usage:
 *   node scripts/verify-integrity.js
 *   node scripts/verify-integrity.js --fix   (attempts safe auto-fixes)
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed (review output)
 */
'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { config } = require('../src/config');

const FIX_MODE = process.argv.includes('--fix');
const pool = new Pool(config.db);

let passed = 0;
let failed = 0;
let fixed  = 0;

function ok(label)       { passed++; console.log(`  ✔  ${label}`); }
function fail(label, detail) { failed++; console.error(`  ✘  ${label}${detail ? `\n       ${detail}` : ''}`); }
function warn(label)     { console.warn(`  ⚠  ${label}`); }
function section(title)  { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`); }

async function run() {
  console.log('VEMA Equipment Bot — Data Integrity Check');
  console.log('='.repeat(60));
  if (FIX_MODE) console.log('FIX MODE enabled — safe auto-fixes will be applied\n');

  // ── 1. Database connectivity ───────────────────────────────────────────
  section('Database');
  try {
    await pool.query('SELECT 1');
    ok('PostgreSQL connectivity');
  } catch (err) {
    fail('PostgreSQL connectivity', err.message);
    console.error('\nCannot continue without database. Aborting.');
    process.exit(1);
  }

  // ── 2. Required extensions ────────────────────────────────────────────
  section('Extensions');
  const trgm = await pool.query("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'");
  if (trgm.rowCount > 0) {
    ok('pg_trgm extension present');
  } else {
    warn('pg_trgm missing — fuzzy search disabled. Run: CREATE EXTENSION pg_trgm;');
  }

  // ── 3. Schema tables ──────────────────────────────────────────────────
  section('Schema');
  const REQUIRED_TABLES = ['users', 'equipment', 'history', 'sessions'];
  for (const table of REQUIRED_TABLES) {
    const res = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name=$1 AND table_schema='public'",
      [table],
    );
    if (res.rowCount > 0) ok(`Table: ${table}`);
    else fail(`Table: ${table}`, 'missing — run: npm run migrate');
  }

  // ── 4. Equipment status values ────────────────────────────────────────
  section('Equipment data');
  const VALID_STATUSES = new Set(['на складе', 'у пользователя', 'в ремонте', 'списано']);
  const invalidStatus = await pool.query(
    `SELECT id, status FROM equipment
     WHERE status NOT IN ('на складе', 'у пользователя', 'в ремонте', 'списано')`,
  );
  if (invalidStatus.rowCount === 0) {
    ok('All equipment have valid status values');
  } else {
    fail(
      `${invalidStatus.rowCount} equipment rows have invalid status`,
      invalidStatus.rows.map((r) => `id=${r.id} status="${r.status}"`).join(', '),
    );
  }

  // ── 5. Equipment with user but no issue date ──────────────────────────
  const missingIssueDate = await pool.query(
    `SELECT id FROM equipment
     WHERE status = 'у пользователя'
       AND (current_holder_user_id IS NULL OR current_issue_date IS NULL)`,
  );
  if (missingIssueDate.rowCount === 0) {
    ok('All issued equipment have holder + issue date');
  } else {
    const ids = missingIssueDate.rows.map((r) => r.id).join(', ');
    fail(`${missingIssueDate.rowCount} issued equipment missing holder/date`, `ids: ${ids}`);

    if (FIX_MODE) {
      await pool.query(
        `UPDATE equipment
         SET current_issue_date = NOW()
         WHERE status = 'у пользователя' AND current_issue_date IS NULL`,
      );
      fixed += missingIssueDate.rowCount;
      console.log(`       → auto-fixed: set current_issue_date = NOW() for ${missingIssueDate.rowCount} rows`);
    }
  }

  // ── 6. Equipment on stock but still has holder ────────────────────────
  const stockWithHolder = await pool.query(
    `SELECT id FROM equipment
     WHERE status = 'на складе'
       AND current_holder_user_id IS NOT NULL`,
  );
  if (stockWithHolder.rowCount === 0) {
    ok('No stock equipment has a stale holder');
  } else {
    const ids = stockWithHolder.rows.map((r) => r.id).join(', ');
    fail(`${stockWithHolder.rowCount} stock equipment have stale holder_user_id`, `ids: ${ids}`);

    if (FIX_MODE) {
      await pool.query(
        `UPDATE equipment
         SET current_holder_user_id = NULL, current_issue_date = NULL
         WHERE status = 'на складе' AND current_holder_user_id IS NOT NULL`,
      );
      fixed += stockWithHolder.rowCount;
      console.log(`       → auto-fixed: cleared holder + issue_date for ${stockWithHolder.rowCount} rows`);
    }
  }

  // ── 7. Serial number uniqueness ───────────────────────────────────────
  const dupSerials = await pool.query(
    `SELECT serial_number, COUNT(*) AS cnt
     FROM equipment
     GROUP BY serial_number
     HAVING COUNT(*) > 1`,
  );
  if (dupSerials.rowCount === 0) {
    ok('No duplicate serial numbers');
  } else {
    const sns = dupSerials.rows.map((r) => `"${r.serial_number}" (${r.cnt}×)`).join(', ');
    fail(`${dupSerials.rowCount} duplicate serial numbers found`, sns);
  }

  // ── 8. Orphaned history records ───────────────────────────────────────
  section('History');
  const orphanHistory = await pool.query(
    `SELECT COUNT(*) AS cnt FROM history h
     WHERE NOT EXISTS (SELECT 1 FROM equipment e WHERE e.id = h.equipment_id)`,
  );
  const orphanCount = Number(orphanHistory.rows[0].cnt);
  if (orphanCount === 0) {
    ok('No orphaned history records');
  } else {
    warn(`${orphanCount} history records reference deleted equipment (FK CASCADE should prevent this)`);
  }

  // ── 9. Users without required fields ──────────────────────────────────
  section('Users');
  const incompleteUsers = await pool.query(
    `SELECT telegram_user_id FROM users
     WHERE first_name IS NULL OR first_name = ''`,
  );
  if (incompleteUsers.rowCount === 0) {
    ok('All users have first_name');
  } else {
    warn(`${incompleteUsers.rowCount} users missing first_name (may be incomplete registrations)`);
  }

  // ── 10. Equipment count summary ───────────────────────────────────────
  section('Summary');
  const stats = await pool.query(
    `SELECT
       COUNT(*)                                            AS total,
       COUNT(*) FILTER (WHERE status='на складе')         AS in_stock,
       COUNT(*) FILTER (WHERE status='у пользователя')    AS with_user,
       COUNT(*) FILTER (WHERE status='в ремонте')         AS in_repair,
       COUNT(*) FILTER (WHERE status='списано')           AS written_off
     FROM equipment`,
  );
  const s = stats.rows[0];
  console.log(`  ℹ  Equipment: ${s.total} total | ${s.in_stock} in stock | ${s.with_user} with user | ${s.in_repair} repair | ${s.written_off} written off`);

  const userCount = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  console.log(`  ℹ  Users: ${userCount.rows[0].cnt} registered`);

  // ── Final report ──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`Checks: ${passed + failed} total, ${passed} passed, ${failed} failed${fixed ? `, ${fixed} auto-fixed` : ''}`);

  if (failed === 0) {
    console.log('✅ All checks passed');
  } else {
    console.error(`❌ ${failed} check(s) failed — review output above`);
    if (!FIX_MODE) console.log('   Tip: run with --fix to attempt safe auto-corrections');
  }

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Unexpected error:', err.message);
  pool.end();
  process.exit(1);
});
