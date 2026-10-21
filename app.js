const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  // Protection against other websites poking at this local server (CSRF / DNS rebinding)
  app.use('/api', (req, res, next) => {
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
    if (loopback) {
      const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) return res.status(403).json({ error: { code: 'BAD_HOST', message: 'Forbidden host.' } });
    }
    const origin = req.headers.origin;
    if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch {} if (!ok) return res.status(403).json({ error: { code: 'BAD_ORIGIN', message: 'Forbidden origin.' } }); }
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: { code: 'JSON_ONLY', message: 'Send JSON.' } });
    }
    next();
  });

  // Optional PIN (set APP_PIN in .env). Static files hold no data, so only the API is gated.
  app.use('/api', (req, res, next) => {
    if (!config.pin) return next();
    const given = Buffer.from(String(req.headers['x-app-pin'] || ''));
    const want = Buffer.from(config.pin);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) return res.status(401).json({ error: { code: 'PIN_REQUIRED', message: 'PIN required.' } });
    next();
  });

  app.use('/api', routes);
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' } }));
  // only /public is served; data/ and backups/ are never reachable
  app.use(express.static(path.join(config.root, 'public'), { dotfiles: 'deny', index: 'index.html' }));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
