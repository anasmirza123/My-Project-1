const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { getDb, closeDb, setDb, open } = require('../db');
const { bad, HttpError } = require('../middleware/error');
const { getSettings } = require('./settings');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');

/** Opens a file read-only and checks it is a healthy copy of THIS app's database. */
function verifyFile(file) {
  let d;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const ok = d.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error('integrity check failed');
    const has = d.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('customers','orders','order_items','settings')`).get().n;
    if (has !== 4) throw new Error('not a Customer Manager database');
    return { customers: d.prepare('SELECT COUNT(*) n FROM customers').get().n, orders: d.prepare('SELECT COUNT(*) n FROM orders').get().n };
  } finally { if (d) d.close(); }
}

function listBackups() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  return fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.sqlite'))
    .map((f) => { const s = fs.statSync(path.join(config.backupDir, f)); return { filename: f, size: s.size, modified: s.mtime.toISOString() }; })
    .sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 50);
}

/** VACUUM INTO writes a consistent snapshot even while the app is running (unlike copying the live file). */
function createBackup(prefix = 'backup') {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const filename = `${prefix}_${stamp()}.sqlite`;
  const target = path.join(config.backupDir, filename);
  getDb().prepare('VACUUM INTO ?').run(target);
  const info = verifyFile(target);
  const warnings = [];
  const extra = getSettings().backup_extra_dir;
  let extraCopy = null;
  if (extra) {
    try { fs.copyFileSync(target, path.join(extra, filename)); extraCopy = path.join(extra, filename); }
    catch (e) { warnings.push(`Backup saved, but copying to ${extra} failed: ${e.code || e.message}`); }
  }
  return { filename, path: target, ...info, extraCopy, warnings };
}

function restoreBackup(filename) {
  const name = path.basename(String(filename || ''));
  if (!name || name !== filename || !name.endsWith('.sqlite')) throw bad('Choose a backup from the list.');
  const source = path.join(config.backupDir, name);
  if (!fs.existsSync(source)) throw new HttpError(404, 'Backup file not found.', 'NOT_FOUND');
  let info;
  try { info = verifyFile(source); } catch (e) { throw bad(`This backup cannot be used: ${e.message}`, 'BAD_BACKUP'); }
  const safety = createBackup('before-restore');          // always keep what we are about to replace
  closeDb();
  try {
    for (const ext of ['-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
    fs.copyFileSync(source, config.dbFile);
  } finally {
    setDb(open());                                         // app keeps working either way
  }
  return { restored: name, ...info, safetyBackup: safety.filename };
}

module.exports = { createBackup, listBackups, restoreBackup, verifyFile };
