/* ============================================================
   DATABASE INITIALIZER - Creates schema, runs migrations
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/database');

function initSchema() {
  const db = getDb();

  // Check if schema already exists
  const hasSettings = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
  ).get();

  if (hasSettings) {
    console.log('[db] schema already initialized — skipping');
    return;
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  console.log('[db] schema initialized from', schemaPath);
}

module.exports = { initSchema };

if (require.main === module) {
  try {
    initSchema();
    console.log('[db] done');
    process.exit(0);
  } catch (e) {
    console.error('[db] init failed:', e.message);
    process.exit(1);
  }
}
