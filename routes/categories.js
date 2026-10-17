const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { httpErr } = require('../utils/helpers');

router.get('/categories', (req, res, next) => {
  try { res.json(getDb().prepare('SELECT * FROM categories ORDER BY name').all()); }
  catch (e) { next(e); }
});

router.post('/categories', (req, res, next) => {
  try {
    const db = getDb();
    const name = (req.body?.name || '').trim();
    if (!name) throw httpErr(400, 'Name required');
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (existing) throw httpErr(409, 'Category already exists');
    const info = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)')
      .run(name, req.body?.description || null);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

router.put('/categories/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) throw httpErr(404, 'Category not found');
    const name = (req.body?.name || '').trim();
    if (!name) throw httpErr(400, 'Name required');
    db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?')
      .run(name, req.body?.description ?? cat.description, id);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

module.exports = router;
