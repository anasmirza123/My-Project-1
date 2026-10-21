import { api } from './api.js';
import { html, mount, fAll, toast, guard, confirmDialog, state } from './ui.js';

export async function settingsView(el) {
  const s = await api.get('/settings');
  mount(el, html`<h1>Settings</h1><form class="card" id="sf" style="max-width:640px">
    <div class="grid g2">
      <div class="field"><label>Timezone (shown on every date and time)</label><input name="timezone" value="${s.timezone}"></div>
      <div class="field"><label>Default currency</label><input name="default_currency" value="${s.default_currency}" maxlength="3"></div>
      <div class="field"><label>Tracking ID prefix</label><input name="tracking_prefix" value="${s.tracking_prefix}" maxlength="6"></div>
      <div class="field"><label>Extra backup folder (e.g. USB drive or OneDrive folder)</label><input name="backup_extra_dir" value="${s.backup_extra_dir || ''}" placeholder="D:\\Backups"></div></div>
    <p class="small muted">Tracking IDs look like ${s.tracking_prefix}-YYYYMMDD-0001. Changing the prefix only affects new orders. Existing records keep their stored times; only the display timezone changes.</p>
    <button class="btn">Save settings</button></form>`);
  el.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    await guard(e.submitter, async () => { state.settings = await api.put('/settings', Object.fromEntries(new FormData(e.target).entries())); toast('Settings saved'); });
  });
}

export async function backupView(el) {
  const [{ backups, folder, database }, health] = await Promise.all([api.get('/backups'), api.get('/health')]);
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  mount(el, html`<h1>Backup &amp; Restore</h1>
    <div class="card"><div class="row between"><div>
      <div><b>Database:</b> <code>${database}</code></div><div><b>Backups folder:</b> <code>${folder}</code></div>
      <div class="small ${health.ok ? '' : 'err-text'}" style="margin-top:6px">Health check: ${health.ok ? 'OK' : 'PROBLEM: ' + health.database} &middot; ${health.customers} customers saved</div></div>
      <button class="btn" id="mk">Create backup now</button></div>
      <p class="small muted" style="margin-bottom:0">A backup kept on the same computer does not protect you if the disk fails. Set an extra backup folder in Settings (USB or a synced cloud folder) so each backup is copied there too.</p></div>
    <h2>Recent backups</h2>
    ${backups.length ? html`<div class="tablewrap"><table><thead><tr><th>File</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>
      ${backups.map((b) => html`<tr><td><code>${b.filename}</code></td><td>${fAll(b.modified)}</td><td>${kb(b.size)}</td><td><button class="btn sm danger" data-restore="${b.filename}">Restore</button></td></tr>`)}</tbody></table></div>`
      : html`<div class="card muted">No backups yet.</div>`}`);
  el.querySelector('#mk').onclick = (e) => guard(e.target, async () => {
    const r = await api.post('/backup', {});
    toast(`Backup saved (${r.customers} customers, ${r.orders} orders)`);
    r.warnings.forEach((w) => toast(w, true));
    backupView(el);
  });
  el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => guard(b, async () => {
    const f = b.dataset.restore;
    const ok = await confirmDialog({ title: 'Restore this backup?', danger: true, okText: 'Restore',
      body: html`<p>Everything saved after <code>${f}</code> was made will be replaced by that backup.</p><p class="small muted">A safety backup of your current data is created first, so this can be undone.</p>` });
    if (!ok) return;
    const r = await api.post('/restore', { filename: f, confirm: true });
    toast(`Restored (${r.customers} customers, ${r.orders} orders). Safety copy: ${r.safetyBackup}`);
    backupView(el);
  })));
}
