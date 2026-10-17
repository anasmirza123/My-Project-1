/* ============================================================
   DIAGNOSTIC SCRIPT
   Run: npm run diagnose
   Checks: port, server, API routes, response types
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

// ---------- Colors ----------
const R = '\x1b[0m';
const G = '\x1b[32m';
const RED = '\x1b[31m';
const Y = '\x1b[33m';
const B = '\x1b[36m';
const DIM = '\x1b[2m';

function ok(msg) { console.log(G + '  ✓ ' + R + msg); }
function fail(msg) { console.log(RED + '  ✗ ' + R + msg); }
function warn(msg) { console.log(Y + '  ! ' + R + msg); }
function info(msg) { console.log(DIM + '    ' + msg + R); }
function header(msg) { console.log('\n' + B + '━━━ ' + msg + ' ━━━' + R); }

// ---------- HTTP GET helper ----------
function httpGet(urlPath) {
  return new Promise((resolve) => {
    const req = http.get({
      host: HOST,
      port: PORT,
      path: urlPath,
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          body,
        });
      });
    });
    req.on('error', (err) => resolve({ error: err }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: new Error('Timed out after 5s') });
    });
  });
}

// ---------- Tests ----------
async function main() {
  console.log('\n' + B + '════════════════════════════════════════' + R);
  console.log(B + '  ANAS MANAGEMENT — DIAGNOSTIC TOOL' + R);
  console.log(B + '════════════════════════════════════════' + R);

  // 1. Files check
  header('File Check');
  const requiredFiles = [
    'server.js',
    'package.json',
    'routes/index.js',
    'routes/dashboard.js',
    'routes/health.js',
    'config/database.js',
    'database/schema.sql',
    'public/index.html',
  ];
  let filesOk = true;
  requiredFiles.forEach((f) => {
    if (fs.existsSync(path.join(__dirname, f))) ok(f);
    else { fail(f + ' — MISSING!'); filesOk = false; }
  });

  // 2. Version check
  header('Version Check');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    info('package.json version: ' + pkg.version);
    info('package.json name: ' + pkg.name);
  } catch (e) {
    warn('Could not read package.json: ' + e.message);
  }

  // 3. Server reachable?
  header('Server Check (port ' + PORT + ')');
  const health = await httpGet('/api/health');
  if (health.error) {
    fail('Cannot connect to server on port ' + PORT);
    info('Error: ' + health.error.message);
    info('');
    info('FIX:');
    info('  1. Open cmd, run: taskkill /F /IM node.exe');
    info('  2. Run: start.bat');
    info('  3. Wait for "RUNNING" message');
    info('  4. Run this diagnose again');
    process.exit(1);
  }

  // 4. Is response JSON?
  if (health.contentType.includes('application/json')) {
    ok('Server is responding with JSON');
    try {
      const data = JSON.parse(health.body);
      info('Health response: ' + JSON.stringify(data).slice(0, 200));
    } catch (e) {
      fail('Cannot parse health JSON: ' + e.message);
    }
  } else if (health.contentType.includes('text/html')) {
    fail('Server responded with HTML (not JSON)');
    warn('Response content-type: ' + health.contentType);
    warn('Response snippet: ' + health.body.slice(0, 200));
    info('');
    info('This means: The URL /api/health is NOT being handled by an API route.');
    info('It is being served as index.html by SPA fallback.');
    info('');
    info('FIX:');
    info('  1. You are running an OLD server.js without /api/health route');
    info('  2. Or routes/index.js is not being required by server.js');
    info('  3. Kill node: taskkill /F /IM node.exe');
    info('  4. Copy the NEW server.js from the latest message');
    info('  5. Ensure routes/ folder has ALL files');
    info('  6. Restart with start.bat');
    process.exit(1);
  } else {
    warn('Unexpected content-type: ' + health.contentType);
    warn('Status: ' + health.status);
    info('Body: ' + health.body.slice(0, 300));
  }

  // 5. Dashboard endpoint
  header('Dashboard Endpoint Check');
  const variants = [
    '/api/dashboard/stats',
    '/api/dashboard/stats?range=all',
    '/api/dashboard/stats?range=all&foo=bar',
  ];
  let dashOk = false;
  for (const v of variants) {
    const r = await httpGet(v);
    if (r.error) {
      fail(v + ' → connection error: ' + r.error.message);
      continue;
    }
    const isJson = r.contentType.includes('application/json');
    if (r.status === 200 && isJson) {
      ok(v + ' → 200 OK (JSON)');
      dashOk = true;
    } else if (r.status === 404 && isJson) {
      fail(v + ' → 404 (JSON) — route NOT registered');
      info('Response: ' + r.body.slice(0, 200));
    } else if (isJson) {
      fail(v + ' → ' + r.status + ' (JSON): ' + r.body.slice(0, 150));
    } else {
      fail(v + ' → ' + r.status + ' (' + r.contentType.split(';')[0] + ') — NOT JSON');
      info('Response starts with: ' + r.body.slice(0, 100).replace(/\n/g, ' '));
    }
  }

  // 6. Debug routes list
  header('Debug Routes');
  const dbg = await httpGet('/api/debug/routes');
  if (dbg.error || dbg.status !== 200) {
    warn('/api/debug/routes not available — your server.js is old');
    info('Update to the latest server.js');
  } else {
    try {
      const data = JSON.parse(dbg.body);
      ok('Found ' + (data.count || 0) + ' routes registered');
      const dash = (data.routes || []).find((r) => r.path.includes('dashboard'));
      if (dash) ok('Dashboard route registered: ' + JSON.stringify(dash));
      else fail('Dashboard route MISSING from router stack');
    } catch (e) {
      fail('Cannot parse debug routes: ' + e.message);
    }
  }

  // 7. Summary
  header('Summary');
  if (dashOk) {
    console.log(G + '\n  ✅ ALL GOOD! Dashboard should work now.' + R);
    console.log('\n  If browser still shows error:');
    console.log('  → Hard refresh: Ctrl+Shift+R');
    console.log('  → Or open Incognito: Ctrl+Shift+N');
    console.log('  → Then visit: http://localhost:' + PORT);
    process.exit(0);
  } else {
    console.log(RED + '\n  ❌ Problems found. See above.' + R);
    console.log('\n  Most likely: you are running an OLD server.js.');
    console.log('  FIX:');
    console.log('    1. Close the black window (or Ctrl+C)');
    console.log('    2. In cmd: taskkill /F /IM node.exe');
    console.log('    3. Copy the LATEST server.js and routes/ folder');
    console.log('    4. Run start.bat again');
    console.log('    5. Run: npm run diagnose');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nDiagnostic crashed:', e);
  process.exit(1);
});
