const nowIso = () => new Date().toISOString();

/** YYYYMMDD of an instant in a given IANA timezone (used for tracking IDs). */
function dayStamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + get('month') + get('day');
}
function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
module.exports = { nowIso, dayStamp, isValidTimeZone };

function tzOffsetMs(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}
/** UTC instant (ISO) of local midnight for 'YYYY-MM-DD' in the given timezone. */
function localDayStartIso(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  let guess = base;
  for (let i = 0; i < 2; i++) guess = base - tzOffsetMs(guess, tz);
  return new Date(guess).toISOString();
}
function localDayEndIso(ymd, tz) { // exclusive end = start of next day
  const next = new Date(Date.UTC(...ymd.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))); 
  next.setUTCDate(next.getUTCDate() + 1);
  return localDayStartIso(next.toISOString().slice(0, 10), tz);
}
module.exports.localDayStartIso = localDayStartIso;
module.exports.localDayEndIso = localDayEndIso;
