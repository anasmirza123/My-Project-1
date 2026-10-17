const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { nowIso } = require('../utils/helpers');

router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM customers').get();
    res.json({
      ok: true,
      time: nowIso(),
      db: getDb().name || 'connected',
      customers: row.n,
      node: process.version
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
