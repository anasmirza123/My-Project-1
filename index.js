const express = require('express');
const customers = require('../services/customers');
const extras = require('../services/extras');
const orders = require('../services/orders');
const dash = require('../services/dashboard');
const backup = require('../services/backup');
const settings = require('../services/settings');
const { listActivity } = require('../services/activity');
const { getDb } = require('../db');
const { notFound, bad } = require('../middleware/error');

const r = express.Router();
const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
};

// customers
r.post('/customers', (req, res) => {
  const out = customers.createCustomer(req.body || {});
  res.status(201).json(out);
});
r.get('/customers', (req, res) => res.json(customers.listCustomers(req.query)));
r.get('/customers/:id', (req, res) => res.json(customers.getCustomer(id(req))));
r.patch('/customers/:id', (req, res) => res.json(customers.updateCustomer(id(req), req.body || {})));
r.put('/customers/:id/categories', (req, res) => res.json(customers.setCategories(id(req), (req.body || {}).categoryIds)));
r.get('/customers/:id/orders', (req, res) => res.json(orders.listOrders({ customer_id: id(req), status: 'all', pageSize: 200 })));
r.get('/customers/:id/messages', (req, res) => res.json(extras.listMessages(id(req))));
r.post('/customers/:id/messages', (req, res) => res.status(201).json(extras.addMessage(id(req), req.body || {})));
r.get('/customers/:id/activity', (req, res) => { customers.getCustomer(id(req)); res.json(listActivity(getDb(), { customerId: id(req) })); });
r.get('/customers/:id/hardware-requirements', (req, res) => res.json(extras.listHardware(id(req))));
r.post('/customers/:id/hardware-requirements', (req, res) => res.status(201).json(extras.addHardware(id(req), req.body || {})));
r.post('/customers/:id/orders', (req, res) => res.status(201).json(orders.createOrder(id(req), req.body || {})));

// categories, hardware, messages
r.get('/categories', (req, res) => res.json(customers.listCategories()));
r.post('/categories', (req, res) => res.status(201).json(customers.createCategory((req.body || {}).name)));
r.patch('/hardware-requirements/:id', (req, res) => res.json(extras.updateHardware(id(req), req.body || {})));
r.patch('/messages/:id', (req, res) => res.json(extras.updateMessage(id(req), req.body || {})));

// orders
r.get('/orders', (req, res) => res.json(orders.listOrders(req.query)));
r.get('/orders/tracking/:trackingId', (req, res) => res.json(orders.getOrderByTracking(req.params.trackingId)));
r.get('/orders/:id', (req, res) => res.json(orders.getOrder(id(req))));
r.patch('/orders/:id', (req, res) => res.json(orders.updateOrder(id(req), req.body || {})));
r.patch('/orders/:id/fulfillment', (req, res) => res.json(orders.updateFulfillment(id(req), req.body || {})));
r.post('/orders/:id/confirm', (req, res) => res.json(orders.confirmOrder(id(req))));
r.post('/orders/:id/finalize', (req, res) => res.json(orders.finalizeOrder(id(req), req.body || {})));
r.post('/orders/:id/cancel', (req, res) => res.json(orders.cancelOrder(id(req), req.body || {})));
r.get('/orders/:id/activity', (req, res) => { orders.getOrder(id(req)); res.json(listActivity(getDb(), { orderId: id(req) })); });

// dashboard & search
r.get('/dashboard/stats', (req, res) => res.json(dash.stats()));
r.get('/search', (req, res) => res.json(dash.search(req.query.q)));

// system
r.get('/health', (req, res) => {
  const db = getDb();
  const integrity = db.pragma('quick_check', { simple: true });
  res.json({ ok: integrity === 'ok', database: integrity, customers: db.prepare('SELECT COUNT(*) n FROM customers').get().n });
});
r.get('/settings', (req, res) => res.json(settings.getSettings()));
r.put('/settings', (req, res) => res.json(settings.updateSettings(req.body || {})));
r.get('/backups', (req, res) => res.json({ backups: backup.listBackups(), folder: require('../config').backupDir, database: require('../config').dbFile }));
r.post('/backup', (req, res) => res.status(201).json(backup.createBackup()));
r.post('/restore', (req, res) => {
  if ((req.body || {}).confirm !== true) throw bad('Restoring must be confirmed explicitly.', 'NOT_CONFIRMED');
  res.json(backup.restoreBackup(req.body.filename));
});

module.exports = r;
