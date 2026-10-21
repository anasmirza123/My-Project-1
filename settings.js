const fs = require('fs');
const { getDb } = require('../db');
const { bad } = require('../middleware/error');
const { isValidTimeZone } = require('../utils/datetime');

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function updateSettings(body) {
  const db = getDb();
  const out = {};
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) throw bad('Unknown timezone. Example: Asia/Karachi');
    out.timezone = body.timezone;
  }
  if (body.tracking_prefix !== undefined) {
    const p = String(body.tracking_prefix).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(p)) throw bad('Tracking prefix must be 1-6 letters or digits.');
    out.tracking_prefix = p;
  }
  if (body.default_currency !== undefined) {
    const c = String(body.default_currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw bad('Currency must be a 3-letter code, e.g. PKR.');
    out.default_currency = c;
  }
  if (body.backup_extra_dir !== undefined) {
    const d = String(body.backup_extra_dir).trim();
    if (d && !(fs.existsSync(d) && fs.statSync(d).isDirectory())) throw bad('That backup folder does not exist.');
    out.backup_extra_dir = d;
  }
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => { for (const [k, v] of Object.entries(out)) up.run(k, v); })();
  return getSettings();
}
module.exports = { getSettings, updateSettings };
