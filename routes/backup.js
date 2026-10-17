const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getDb, reopenDb, DB_PATH, BACKUP_DIR } = require('../config/database');
const { httpErr } = require('../utils/helpers');

router.get('/backups', (req, res, next) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sqlite'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json(files);
  } catch (e) { next(e); }
});

router.post('/backup', (req, res, next) => {
  try {
    const db = getDb();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = 'backup-' + ts + '.sqlite';
    const dest = path.join(BACKUP_DIR, filename);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    res.json({ filename, path: dest });
  } catch (e) { next(e); }
});

router.post('/restore', (req, res, next) => {
  try {
    const filename = req.body?.filename;
    if (!filename) throw httpErr(400, 'Filename required');
    const safe = path.basename(filename);
    const src = path.join(BACKUP_DIR, safe);
    if (!fs.existsSync(src)) throw httpErr(404, 'Backup not found');

    let probe;
    try {
      probe = new Database(src, { readonly: true });
      const t = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();
      if (!t) throw new Error('Invalid');
      probe.close();
    } catch (err) {
      throw httpErr(400, 'Invalid backup file');
    }

    const db = getDb();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safety = path.join(BACKUP_DIR, 'pre-restore-' + ts + '.sqlite');
    db.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);

    // Close current, replace, reopen
    db.close();
    fs.copyFileSync(src, DB_PATH);
    for (const ext of ['-wal', '-shm']) {
      const f = DB_PATH + ext;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    reopenDb();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
