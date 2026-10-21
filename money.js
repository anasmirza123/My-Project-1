// Money is stored as integer minor units (paisa). No floats are used for arithmetic.
function parseMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  const s = String(value).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Invalid amount: ' + value);
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
function isMinor(n) { return Number.isSafeInteger(n) && n >= 0; }
module.exports = { parseMoney, isMinor };
