// Small helpers. html`...` escapes every interpolated value unless it is itself html`...` / raw().
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const one = (v) => (v instanceof Raw ? v.s : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) { const v = vals[i]; out += Array.isArray(v) ? v.map(one).join('') : one(v); } });
  return new Raw(out);
}
export const mount = (el, r) => { el.innerHTML = r.s; };

export const state = { settings: { timezone: 'Asia/Karachi', default_currency: 'PKR', tracking_prefix: 'NT' } };

// ── dates: stored in UTC, shown in the configured timezone ──
const fmt = (opts) => (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: state.settings.timezone, ...opts }).format(new Date(iso)) : '');
export const fDate = (iso) => fmt({ day: 'numeric', month: 'long', year: 'numeric' })(iso);
export const fTime = (iso) => (iso ? new Intl.DateTimeFormat('en-US', { timeZone: state.settings.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '');
export const fDay = (iso) => fmt({ weekday: 'long' })(iso);
export const fAll = (iso) => (iso ? `${fDate(iso)}, ${fTime(iso)} (${fDay(iso)})` : '');

// ── money: server speaks integer minor units; the browser only formats ──
export function fMoney(minor, cur) {
  if (minor === null || minor === undefined) return '';
  const whole = Math.trunc(minor / 100), frac = Math.abs(minor % 100);
  const w = whole.toLocaleString('en-US');
  return `${cur || state.settings.default_currency} ${w}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
export function toMinor(str) { // exact, no floats; returns null when not a valid amount
  const s = String(str ?? '').replace(/,/g, '').trim();
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}
export const minorToInput = (m) => (m === null || m === undefined || m === 0 ? '' : (m % 100 ? (m / 100).toFixed(2) : String(m / 100)));

export const code = (id) => 'C-' + String(id).padStart(5, '0');

// ── feedback ──
export function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 2800);
}
export function confirmDialog({ title, body, okText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const d = document.getElementById('dialog');
    mount(d, html`<h2>${title}</h2><div>${body}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn sec" value="no">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" value="yes">${okText}</button></div>`);
    d.onclose = () => resolve(d.returnValue === 'yes');
    d.returnValue = 'no';
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => d.close(b.value)));
    d.showModal();
  });
}
export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast(`${label}: ${text}`);
}
export const copyBtn = (text, label) => html`<button type="button" class="copy" data-copy="${text}" data-label="${label || 'Copied'}" title="Copy">copy</button>`;
export function wireCopy(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); copyText(b.dataset.copy, b.dataset.label); }));
}
export function errMsg(e) { return e?.message || 'Something went wrong'; }
export async function guard(btn, fn) { // prevents double submits; always re-enables
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), true); } finally { if (btn) btn.disabled = false; }
}
export const badge = (name) => html`<span class="badge b-${name}">${name}</span>`;
export const statusBadge = (s) => html`<span class="badge s-${s}">${s}</span>`;
export const catBadges = (csv) => (csv ? csv.split(',').map(badge) : [html`<span class="muted small">Uncategorized</span>`]);
export const empty = (msg) => html`<div class="empty">${msg}</div>`;

export function pager(total, page, pageSize, makeHref) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return html`<div class="pager small muted">${total} record${total === 1 ? '' : 's'}
    ${page > 1 ? html`<a href="${makeHref(page - 1)}">&larr; Prev</a>` : ''}
    <span>Page ${page} of ${pages}</span>
    ${page < pages ? html`<a href="${makeHref(page + 1)}">Next &rarr;</a>` : ''}</div>`;
}
