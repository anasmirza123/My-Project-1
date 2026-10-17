// Standard route names required by the API spec, mapped onto the existing handlers, plus the missing endpoints
// (payment reversal, refunds list, messages list, recent activity). Register right after express.json().
export function registerCompat(app, db, { httpError, logActivity, calcFin }) {
  const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
  const page = (q) => ({ limit: Math.min(parseInt(q.limit || '50', 10) || 50, 200), offset: Math.max(parseInt(q.offset || '0', 10) || 0, 0) });

  // PUT /api/{customers|orders|categories|followups}/:id behaves exactly like the existing PATCH handler.
  app.use((req, res, next) => { if (req.method === 'PUT' && /^\/api\/(customers|orders|categories|followups)\/\d+$/.test(req.path)) req.method = 'PATCH'; next(); });

  // Must be registered before /api/orders/:id so "completed" is not treated as an id.
  app.get('/api/orders/completed', (req, res, next) => { req.query = { ...req.query, status: 'completed' }; req.url = '/api/register'; next(); });
  app.get('/api/requirements', (req, res, next) => { req.url = '/api/hardware'; next(); });
  app.post('/api/payments', wrap((req, res, next) => {
    const id = Number((req.body || {}).order_id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'order_id is required');
    req.url = `/api/orders/${id}/payments`; next();
  }));

  app.get('/api/dashboard/recent-activity', wrap((req, res) => {
    const n = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    const rows = db.prepare('SELECT id, customer_id, order_id, action_type, details_json, created_at FROM activity_logs ORDER BY id DESC LIMIT ?').all(n)
      .map(({ details_json, ...r }) => { let d = null; try { d = details_json ? JSON.parse(details_json) : null; } catch { d = null; } return { ...r, details: d }; });
    res.json({ rows });
  }));

  app.get('/api/refunds', wrap((req, res) => {
    const w = [], p = []; if (req.query.order_id) { w.push('r.order_id = ?'); p.push(Number(req.query.order_id)); }
    const W = w.length ? ' WHERE ' + w.join(' AND ') : '', { limit, offset } = page(req.query);
    const base = `FROM refunds r JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = o.customer_id${W}`;
    res.json({ total: db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...p).n, limit, offset,
      rows: db.prepare(`SELECT r.*, o.tracking_id, COALESCE(o.customer_name_snapshot, c.name) AS customer_name, COALESCE(o.customer_phone_snapshot, c.phone) AS customer_phone ${base} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset) });
  }));

  app.get('/api/messages', wrap((req, res) => {
    const w = [], p = []; if (req.query.customer_id) { w.push('m.customer_id = ?'); p.push(Number(req.query.customer_id)); }
    if (req.query.search) { w.push('(m.message_text LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); const s = `%${req.query.search}%`; p.push(s, s, s); }
    const W = w.length ? ' WHERE ' + w.join(' AND ') : '', { limit, offset } = page(req.query);
    const base = `FROM customer_messages m JOIN customers c ON c.id = m.customer_id${W}`;
    res.json({ total: db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...p).n, limit, offset,
      rows: db.prepare(`SELECT m.*, c.name AS customer_name, c.phone AS customer_phone ${base} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...p, limit, offset) });
  }));

  // Payments are never deleted: a reversal marks the transaction 'cancelled', recalculates the order and writes the audit log.
  app.post('/api/payments/:id/reverse', wrap((req, res) => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid payment id');
    const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(id); if (!pay) throw httpError(404, 'Payment not found');
    if (pay.payment_status === 'cancelled') throw httpError(409, 'Payment is already reversed');
    const reason = String((req.body || {}).reason || '').slice(0, 500) || null, now = new Date().toISOString();
    db.prepare("UPDATE payments SET payment_status = 'cancelled', notes = TRIM(COALESCE(notes,'') || ' [reversed: ' || COALESCE(?, 'no reason given') || ']') WHERE id = ?").run(reason, id);
    const fin = calcFin(pay.order_id, db), order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(pay.order_id);
    if (fin) db.prepare('UPDATE orders SET payment_status = ?, amount_received_minor = ?, updated_at = ? WHERE id = ?').run(fin.calculatedPaymentStatus, fin.netAmountReceived, now, pay.order_id);
    logActivity({ customerId: order && order.customer_id, orderId: pay.order_id, actionType: 'payment_reversed', details: { paymentId: id, amountMinor: pay.amount_minor, reason } });
    res.json({ payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(id), payment_status: fin && fin.calculatedPaymentStatus, amount_received_minor: fin && fin.netAmountReceived, remaining_balance_minor: fin && fin.remainingBalance });
  }));
}
