function logActivity(db, { customerId = null, orderId = null, type, details = null }) {
  db.prepare('INSERT INTO activity_logs(customer_id, order_id, action_type, details_json) VALUES (?,?,?,?)')
    .run(customerId, orderId, type, details ? JSON.stringify(details) : null);
}
function listActivity(db, { customerId, orderId }) {
  const rows = customerId
    ? db.prepare('SELECT * FROM activity_logs WHERE customer_id = ? ORDER BY id DESC LIMIT 200').all(customerId)
    : db.prepare('SELECT * FROM activity_logs WHERE order_id = ? ORDER BY id DESC LIMIT 200').all(orderId);
  return rows.map((r) => ({ ...r, details: r.details_json ? JSON.parse(r.details_json) : null, details_json: undefined }));
}
module.exports = { logActivity, listActivity };
