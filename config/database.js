/* ============================================================
   DATABASE CONNECTION MODULE
   ============================================================ */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'anas-management.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    console.log('[db] connected:', DB_PATH);
  }
  return db;
}

function closeDb() {
  if (db) {
    try { db.close(); } catch (e) {}
    db = null;
  }
}

function reopenDb() {
  closeDb();
  return getDb();
}

module.exports = { getDb, closeDb, reopenDb, DB_PATH, DATA_DIR, BACKUP_DIR, ROOT };
