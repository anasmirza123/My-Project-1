const fs = require('fs');
const path = require('path');

// minimal .env loader (no extra dependency)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const root = path.join(__dirname, '..');
const abs = (p, fallback) => path.resolve(root, p || fallback);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  dataDir: abs(process.env.DATA_DIR, './data'),
  backupDir: abs(process.env.BACKUP_DIR, './backups'),
  dbFile: path.join(abs(process.env.DATA_DIR, './data'), 'customer-management.sqlite'),
  pin: process.env.APP_PIN || '',
  root,
};
