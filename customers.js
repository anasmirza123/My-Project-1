const { getDb } = require('../db');
const { HttpError, bad, notFound } = require('../middleware/error');
const { normalizePhone, waLink } = require('../utils/phone');
const { nowIso, localDayStartIso, localDayEndIso } = require('../utils/datetime');
const { logActivity } = require('./activity');
const { getSettings } = require('./settings');
const { clean, likeEscape, paging } = require('./util');

const EDITABLE = ['name', 'alternate_phone', 'email', 'address', 'city', 'province', 'country',
  'status', 'lead_status', 'lead_source', 'preferred_contact', 'notes'];
const STATUSES = ['active', 'inactive', 'archived'];
const LEAD_STATUSES = ['new', 'contacted', 'interested', 'follow_up', 'converted', 'not_interested'];

const decorate = (c) => c && ({ ...c, whatsapp_link: waLink(c.whatsapp_normalized) });

function createCustomer({ phone, force = false }) {
  const db = getDb();
  const n = normalizePhone(phone, { force });
  if (!n.ok) {
    if (n.reason === 'EMPTY') throw bad('Enter a phone number.', 'EMPTY_PHONE');
    if (n.reason === 'TOO_SHORT') throw bad('That is too short to be a phone number.', 'TOO_SHORT');
    throw new HttpError(422, 'This does not look like a valid phone number. Save it anyway?', 'INVALID_PHONE', { canForce: true });
  }
  const existing = db.prepare('SELECT * FROM customers WHERE phone_normalized = ?').get(n.normalized);
  if (existing) {
    throw new HttpError(409, 'This number is already saved.', 'DUPLICATE', { customer: decorate(existing) });
  }
  const id = db.transaction(() => {
    const now = nowIso();
    const r = db.prepare('INSERT INTO customers(phone, phone_normalized, created_at, updated_at) VALUES (?,?,?,?)')
      .run(String(phone).trim(), n.normalized, now, now);
    logActivity(db, { customerId: r.lastInsertRowid, type: 'customer_created', details: { phone: n.normalized } });
    return r.lastInsertRowid;
  })();
  return { customer: getCustomer(Number(id)), phoneValid: n.valid };
}

const SELECT_LIST = `
  SELECT c.*,
    (SELECT group_concat(g.name, ',') FROM customer_categories cc JOIN categories g ON g.id = cc.category_id
       WHERE cc.customer_id = c.id) AS categories,
    (SELECT status FROM orders o WHERE o.customer_id = c.id ORDER BY o.id DESC LIMIT 1) AS latest_order_status,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS completed_orders,
    (SELECT COUNT(*) FROM hardware_requirements h WHERE h.customer_id = c.id) AS hardware_count,
    (SELECT group_concat(COALESCE(h.product_name,'(unnamed)') || COALESCE(' x' || h.quantity,''), '; ')
       FROM hardware_requirements h WHERE h.customer_id = c.id) AS hardware_summary
  FROM customers c`;

const catExists = (name) => `EXISTS (SELECT 1 FROM customer_categories cc JOIN categories g ON g.id = cc.category_id
    WHERE cc.customer_id = c.id AND g.name = '${name}')`;
const VIEWS = {
  all: '1=1',
  wholesale: catExists('Wholesale'),
  retail: catExists('Retail'),
  leads: catExists('Lead'),
  other: catExists('Other'),
  previous: `EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed')`,
  hardware: `EXISTS (SELECT 1 FROM hardware_requirements h WHERE h.customer_id = c.id)`,
  uncategorized: `NOT EXISTS (SELECT 1 FROM customer_categories cc WHERE cc.customer_id = c.id)`,
};

function listCustomers(q) {
  const db = getDb();
  const settings = getSettings();
  const view = q.view || 'all';
  if (!VIEWS[view]) throw bad('Unknown customer view.');
  const where = [VIEWS[view]]; const args = [];
  if (q.status && q.status !== 'any') { where.push('c.status = ?'); args.push(q.status); }
  else if (!q.status) where.push(`c.status <> 'archived'`);
  if (q.lead_status) { where.push('c.lead_status = ?'); args.push(q.lead_status); }
  if (q.q && String(q.q).trim()) {
    const like = likeEscape(q.q); const digits = String(q.q).replace(/\D/g, '');
    const parts = [`c.name LIKE ? ESCAPE '\\'`, `c.phone LIKE ? ESCAPE '\\'`, `c.whatsapp LIKE ? ESCAPE '\\'`];
    args.push(like, like, like);
    if (digits.length >= 3) {
      parts.push(`c.phone_normalized LIKE ?`, `c.whatsapp_normalized LIKE ?`, `c.alternate_phone LIKE ? ESCAPE '\\'`);
      // local format 0300... should match +92300...: drop one leading zero
      const tail = digits.replace(/^0/, '');
      args.push('%' + tail + '%', '%' + tail + '%', like);
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  if (q.from) { where.push('c.created_at >= ?'); args.push(localDayStartIso(q.from, settings.timezone)); }
  if (q.to) { where.push('c.created_at < ?'); args.push(localDayEndIso(q.to, settings.timezone)); }
  const dir = q.sort === 'oldest' ? 'ASC' : 'DESC';
  const { page, pageSize, offset } = paging(q);
  const total = db.prepare(`SELECT COUNT(*) n FROM customers c WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`${SELECT_LIST} WHERE ${where.join(' AND ')} ORDER BY c.created_at ${dir}, c.id ${dir} LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset);
  return { items: rows.map(decorate), total, page, pageSize };
}

function getCustomer(id) {
  const db = getDb();
  const c = db.prepare(`${SELECT_LIST} WHERE c.id = ?`).get(id);
  if (!c) throw notFound('Customer not found');
  c.category_list = db.prepare(`SELECT g.id, g.name FROM customer_categories cc JOIN categories g ON g.id = cc.category_id
    WHERE cc.customer_id = ? ORDER BY g.id`).all(id);
  return decorate(c);
}

function updateCustomer(id, body) {
  const db = getDb();
  const before = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!before) throw notFound('Customer not found');
  const sets = {}; 
  for (const f of EDITABLE) if (body[f] !== undefined) sets[f] = clean(body[f]);
  if (sets.status !== undefined && !STATUSES.includes(sets.status)) throw bad('Status must be active, inactive or archived.');
  if (sets.status === null) delete sets.status;
  if (sets.lead_status && !LEAD_STATUSES.includes(sets.lead_status)) throw bad('Unknown lead status.');
  if (sets.email && !/^\S+@\S+\.\S+$/.test(sets.email)) throw bad('Email address looks invalid.');
  if (body.phone !== undefined) {
    const n = normalizePhone(body.phone, { force: !!body.force });
    if (!n.ok) {
      if (n.reason !== 'INVALID') throw bad('That is not a usable phone number.', 'TOO_SHORT');
      throw new HttpError(422, 'Invalid phone number. Save it anyway?', 'INVALID_PHONE', { canForce: true });
    }
    const dup = db.prepare('SELECT id FROM customers WHERE phone_normalized = ? AND id <> ?').get(n.normalized, id);
    if (dup) throw new HttpError(409, 'Another customer already has this number.', 'DUPLICATE', { customer: getCustomer(dup.id) });
    sets.phone = String(body.phone).trim(); sets.phone_normalized = n.normalized;
  }
  if (body.whatsapp !== undefined) {
    const w = clean(body.whatsapp);
    if (w) {
      const n = normalizePhone(w, { force: true });
      if (!n.ok) throw bad('WhatsApp number looks invalid.');
      sets.whatsapp = w; sets.whatsapp_normalized = n.normalized;
    } else { sets.whatsapp = null; sets.whatsapp_normalized = null; }
  }
  const keys = Object.keys(sets);
  if (!keys.length) return getCustomer(id);
  db.transaction(() => {
    db.prepare(`UPDATE customers SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => sets[k]), nowIso(), id);
    const changed = {};
    for (const k of keys) if (before[k] !== sets[k]) changed[k] = { from: before[k], to: sets[k] };
    if (Object.keys(changed).length) logActivity(db, { customerId: id, type: 'customer_updated', details: changed });
  })();
  return getCustomer(id);
}

function setCategories(id, categoryIds) {
  const db = getDb();
  if (!Array.isArray(categoryIds)) throw bad('categoryIds must be a list.');
  const c = db.prepare('SELECT id, lead_status FROM customers WHERE id = ?').get(id);
  if (!c) throw notFound('Customer not found');
  const ids = [...new Set(categoryIds.map(Number))];
  const cats = ids.length ? db.prepare(`SELECT id, name FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  if (cats.length !== ids.length) throw bad('One of the categories does not exist.');
  db.transaction(() => {
    const old = db.prepare(`SELECT g.name FROM customer_categories cc JOIN categories g ON g.id = cc.category_id WHERE cc.customer_id = ?`)
      .all(id).map((r) => r.name);
    db.prepare('DELETE FROM customer_categories WHERE customer_id = ?').run(id);
    const ins = db.prepare('INSERT INTO customer_categories(customer_id, category_id) VALUES (?,?)');
    for (const cat of cats) ins.run(id, cat.id);
    if (cats.some((x) => x.name === 'Lead') && !c.lead_status) db.prepare('UPDATE customers SET lead_status = ? WHERE id = ?').run('new', id);
    db.prepare('UPDATE customers SET updated_at = ? WHERE id = ?').run(nowIso(), id);
    logActivity(db, { customerId: id, type: 'categories_changed', details: { from: old, to: cats.map((x) => x.name) } });
  })();
  return getCustomer(id);
}

function listCategories() {
  return getDb().prepare('SELECT id, name FROM categories ORDER BY id').all();
}
function createCategory(name) {
  const n = clean(name);
  if (!n || n.length > 40) throw bad('Category name is required (max 40 characters).');
  const r = getDb().prepare('INSERT INTO categories(name) VALUES (?)').run(n);
  return { id: Number(r.lastInsertRowid), name: n };
}

module.exports = { createCustomer, listCustomers, getCustomer, updateCustomer, setCategories, listCategories, createCategory, LEAD_STATUSES };
