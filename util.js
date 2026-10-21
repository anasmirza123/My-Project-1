const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const likeEscape = (q) => '%' + String(q).trim().replace(/[\\%_]/g, (m) => '\\' + m) + '%';
function paging(q) {
  const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 25, 1), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { pageSize, page, offset: (page - 1) * pageSize };
}
module.exports = { clean, likeEscape, paging };
