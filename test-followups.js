// Run: node test-followups.js   (needs Node 22+ for the built-in node:sqlite). Tests the follow-up/purchase module against real SQLite
// using a minimal customers/orders schema and a tiny fake router - it does not start the full Express server.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { registerFollowups, FOLLOWUP_SCHEMA, todayKarachi } from './followups.js';
const raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA foreign_keys=ON');
raw.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, phone TEXT, whatsapp TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY, tracking_id TEXT, customer_id INTEGER REFERENCES customers(id), status TEXT, finalized_at TEXT, created_at TEXT, customer_name_snapshot TEXT, customer_phone_snapshot TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_name TEXT);
CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, customer_id INT, order_id INT, action_type TEXT, details_json TEXT);`);
raw.exec(FOLLOWUP_SCHEMA); raw.exec(FOLLOWUP_SCHEMA); // second run proves the migration is idempotent
const db = { prepare: (s) => { const st = raw.prepare(s); return { run: (...a) => { const r = st.run(...a); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }; }, get: (...a) => st.get(...a), all: (...a) => st.all(...a) }; } };
const routes = {}; const app = Object.fromEntries(['get', 'post', 'patch'].map((m) => [m, (p, f) => { routes[m.toUpperCase() + ' ' + p] = f; }]));
const httpError = (status, message) => Object.assign(new Error(message), { status });
registerFollowups(app, db, { httpError, logActivity: (a) => raw.prepare('INSERT INTO activity_logs(customer_id,order_id,action_type) VALUES(?,?,?)').run(a.customerId || null, a.orderId || null, a.actionType),
  calcFin: (id) => ({ netAmountReceived: 30000, remainingBalance: 20000, totalSaleAmount: 50000, totalPurchaseCost: null, estimatedGrossProfit: null, calculatedPaymentStatus: 'partial' }) });
const call = (key, { params = {}, query = {}, body = {} } = {}) => { let out; const res = { code: 200, status(c) { this.code = c; return this; }, json(x) { out = { code: this.code, body: x }; } };
  routes[key](({ params, query, body }), res, (e) => { out = { code: e.status || 500, body: { error: e.message } }; }); return out; };
const day = (n) => new Date(Date.parse(todayKarachi() + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('PASS', name); };
raw.exec("INSERT INTO customers VALUES(1,'Ali','0300111','0300111'),(2,'Sara','0300222',NULL); INSERT INTO orders VALUES(10,'NT-20261017-0001',1,'completed','2026-10-17T05:00:00Z','2026-10-16T05:00:00Z','Ali (old name)','0300111'),(11,'NT-20261017-0002',1,'pending',NULL,'2026-10-17T06:00:00Z',NULL,NULL),(12,'NT-20261017-0003',2,'completed','2026-10-17T07:00:00Z','2026-10-17T06:00:00Z',NULL,NULL); INSERT INTO order_items VALUES(1,10,'Bag'),(2,10,'Cap'),(3,12,'Shirt')");
let id1, id2, id3;
ok('create today/overdue/upcoming -> 201', () => { id1 = call('POST /api/followups', { body: { customer_id: 1, order_id: 10, follow_up_date: day(0), follow_up_time: '15:30', type: 'Next Visit', purpose: 'Check bags' } });
  assert.equal(id1.code, 201); id1 = id1.body.id; id2 = call('POST /api/followups', { body: { customer_id: 2, follow_up_date: day(-2), type: 'Payment Collection' } }).body.id; id3 = call('POST /api/followups', { body: { customer_id: 2, follow_up_date: day(5) } }).body.id; });
ok('duplicate active follow-up -> 409', () => assert.equal(call('POST /api/followups', { body: { customer_id: 1, order_id: 10, follow_up_date: day(0), type: 'Next Visit' } }).code, 409));
ok('invalid date/time/type/customer/order -> 400/404', () => { const b = { customer_id: 1, follow_up_date: day(1) };
  assert.equal(call('POST /api/followups', { body: { ...b, follow_up_date: '2026-02-31' } }).code, 400); assert.equal(call('POST /api/followups', { body: { ...b, follow_up_time: '25:00' } }).code, 400);
  assert.equal(call('POST /api/followups', { body: { ...b, type: 'Bogus' } }).code, 400); assert.equal(call('POST /api/followups', { body: { ...b, customer_id: 99 } }).code, 404);
  assert.equal(call('POST /api/followups', { body: { ...b, order_id: 12 } }).code, 400); });
ok('dashboard counts today=1 overdue=1 upcoming=1', () => { const d = call('GET /api/dashboard/followups').body; assert.deepEqual([d.due_today, d.overdue, d.upcoming, d.customers_needing_followup], [1, 1, 1, 2]); });
ok('state filters + search', () => { assert.equal(call('GET /api/followups', { query: { state: 'overdue' } }).body.rows[0].id, id2); assert.equal(call('GET /api/followups', { query: { state: 'active' } }).body.total, 3);
  assert.equal(call('GET /api/followups', { query: { search: 'NT-20261017-0001' } }).body.rows.length, 1); assert.equal(call('GET /api/followups', { query: { state: 'nope' } }).code, 400); });
ok('row carries previous purchase, paid and balance', () => { const r = call('GET /api/followups', { query: { state: 'due_today' } }).body.rows[0]; assert.deepEqual([r.tracking_id, r.amount_paid_minor, r.balance_minor, r.state], ['NT-20261017-0001', 30000, 20000, 'due_today']); });
ok('reschedule -> status rescheduled, count 1', () => { const r = call('POST /api/followups/:id/reschedule', { params: { id: id1 }, body: { follow_up_date: day(3) } }).body; assert.deepEqual([r.status, r.reschedule_count, r.state], ['rescheduled', 1, 'upcoming']); });
ok('complete does not touch other follow-ups; completed cannot be completed again', () => { assert.equal(call('POST /api/followups/:id/complete', { params: { id: id2 } }).body.status, 'completed');
  assert.equal(call('POST /api/followups/:id/complete', { params: { id: id2 } }).code, 409); assert.equal(call('GET /api/dashboard/followups').body.overdue, 0); assert.equal(call('GET /api/followups', { query: { state: 'active' } }).body.total, 2); });
ok('cancel + edit', () => { assert.equal(call('POST /api/followups/:id/cancel', { params: { id: id3 } }).body.status, 'cancelled'); assert.equal(call('PATCH /api/followups/:id', { params: { id: id1 }, body: { notes: 'bring samples' } }).body.notes, 'bring samples'); });
ok('purchases: only completed orders, once each, snapshot name kept', () => { const r = call('GET /api/purchases').body; assert.equal(r.total, 2); const a = r.rows.find((x) => x.order_id === 10);
  assert.deepEqual([a.customer_name, a.products, a.cost_minor, a.profit_minor], ['Ali (old name)', 'Bag, Cap', null, null]); assert.equal(call('GET /api/customers/:id/purchases', { params: { id: 1 } }).body.total, 1); });
ok('activity log written for each follow-up action', () => assert.ok(raw.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action_type LIKE 'followup_%'").get().n >= 6));
ok('real database error surfaces as 500, not 404', () => { raw.exec('DROP TABLE order_items'); assert.equal(call('GET /api/purchases').code, 500); });
console.log(`\n${pass} tests passed`);
