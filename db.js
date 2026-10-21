const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

let db = null;

// Each entry upgrades the database by one version (PRAGMA user_version).
const migrations = [
  (d) => d.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')),
];

function open(file = config.dbFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
  let v = d.pragma('user_version', { simple: true });
  while (v < migrations.length) {
    d.transaction(() => { migrations[v](d); d.pragma(`user_version = ${v + 1}`); })();
    v++;
  }
  return d;
}

function getDb() { if (!db) db = open(); return db; }
function setDb(d) { db = d; }
function closeDb() { if (db) { db.close(); db = null; } }

module.exports = { getDb, setDb, closeDb, open };
