export const FOLLOWUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  note TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export function registerFollowups(app, db, { httpError, logActivity }) {
  app.get('/api/followups', (req, res, next) => {
    try {
      const rows = db.prepare(`
        SELECT f.*, c.name AS customer_name, c.phone AS customer_phone 
        FROM followups f JOIN customers c ON c.id = f.customer_id 
        ORDER BY f.due_date ASC
      `).all();
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post('/api/followups', (req, res, next) => {
    try {
      const { customer_id, due_date, note } = req.body;
      if (!customer_id || !due_date) throw httpError(400, 'Customer ID and due date are required');
      
      const info = db.prepare(`
        INSERT INTO followups (customer_id, due_date, note) VALUES (?, ?, ?)
      `).run(customer_id, due_date, note || null);
      
      logActivity({ customerId: customer_id, actionType: 'followup_created', details: { due_date } });
      res.status(201).json(db.prepare('SELECT * FROM followups WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) { next(e); }
  });

  app.put('/api/followups/:id', (req, res, next) => {
    try {
      const { status } = req.body;
      const id = Number(req.params.id);
      db.prepare('UPDATE followups SET status = ? WHERE id = ?').run(status, id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
