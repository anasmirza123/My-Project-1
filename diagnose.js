// Usage: npm run diagnose   |   node diagnose.js --wait-open   (waits for health, then opens the browser)
import { exec } from 'node:child_process';
const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
async function probe(p) {
  try {
    const r = await fetch(base + p), t = await r.text(), ct = r.headers.get('content-type') || '';
    let j = null; try { j = JSON.parse(t); } catch {}
    return { p, status: r.status, ct, json: ct.includes('json') && j !== null, body: t.slice(0, 100).replace(/\s+/g, ' ') };
  } catch (e) { return { p, error: e.cause?.code || e.message }; }
}
if (process.argv.includes('--wait-open')) {
  for (let i = 0; i < 30; i++) {
    const h = await probe('/api/health');
    if (h.status === 200 && h.json) { exec(`start "" "${base}"`); process.exit(0); }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error('The server did not become healthy within 30 seconds. Check the server window for errors.'); process.exit(1);
}
let bad = 0;
for (const p of ['/api/health', '/api/dashboard/stats', '/api/this-route-does-not-exist']) {
  const r = await probe(p); const expect404 = p.includes('does-not-exist');
  const ok = !r.error && r.json && (expect404 ? r.status === 404 : r.status === 200);
  console.log(`${ok ? 'PASS' : 'FAIL'}  GET ${p}  ->  ${r.error ? 'no connection (' + r.error + ')' : `${r.status} ${r.ct}  ${r.body}`}`);
  if (!ok) bad++;
}
console.log(bad ? `\n${bad} check(s) failed. A reply that is HTML or not JSON means something other than the Anas server (static/Live Server/another app) is answering on ${base}. "no connection" means the server is not running.` : '\nBackend and database are responding correctly.');
process.exit(bad ? 1 : 0);
