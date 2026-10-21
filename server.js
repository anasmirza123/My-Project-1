const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`This app needs Node.js 22 or newer (you have ${process.versions.node}). Install the LTS version from https://nodejs.org`);
  process.exit(1);
}
const config = require('./config');
const { getDb, closeDb } = require('./db');
const { createApp } = require('./app');

getDb(); // opens + migrates the database before accepting requests
const server = createApp().listen(config.port, config.host, (err) => {
  if (err) return; // Express 5 passes listen errors here too; the 'error' handler below reports them
  console.log(`Customer Manager running at http://localhost:${config.port}`);
  console.log(`Database: ${config.dbFile}`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') console.log('WARNING: reachable from other devices on your network. Set APP_PIN.');
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Is the app already running?` : e);
  process.exit(1);
});
const stop = () => { server.close(() => { closeDb(); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
