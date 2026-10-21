const { dayStamp } = require('../utils/datetime');

/**
 * Collision-safe: one counter row per local day, incremented atomically inside the
 * caller's transaction. A number is never derived from MAX()+1, so it can't be reused
 * even if an order is later removed. UNIQUE(tracking_id) is the final safety net.
 */
function nextTrackingId(db, date, settings) {
  const day = dayStamp(date, settings.timezone);
  const { last_seq } = db.prepare(
    `INSERT INTO tracking_counters(day, last_seq) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1
     RETURNING last_seq`).get(day);
  return `${settings.tracking_prefix}-${day}-${String(last_seq).padStart(4, '0')}`;
}
module.exports = { nextTrackingId };
