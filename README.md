# Customer CRM — Local

A single-user, offline-first customer management & order tracking system.
One `index.html` frontend, one `server.js` backend, one SQLite database.

## Requirements
- **Node.js 18+** — https://nodejs.org/

## Run
1. Put all files in one folder.
2. Double-click **`start.bat`**.

First run installs dependencies and creates the database. Everything works offline after that.

## Files
| File | Purpose |
|---|---|
| `index.html` | Complete frontend (HTML + CSS + JS) |
| `server.js` | Backend (Express + better-sqlite3 + schema) |
| `package.json` | Dependencies |
| `start.bat` | Windows launcher |
| `data/` | SQLite DB (auto-created) |
| `backups/` | Backup files (auto-created) |

## Workflow
1. **Dashboard** → enter a phone number → **Save**. The number is stored immediately.
2. On the customer page, click **Categories** → tick Wholesale / Retail / Lead / Other → Save.
3. **Orders tab** → **+ New Order** → add items → **Save pricing** → **★ Finalize**.
   - Generates tracking ID like `NT-20251016-0001`.
   - Locks the price and snapshots the customer's current details.
   - Records the exact finalization date, time, and day (Asia/Karachi).
4. **Completed Orders** in the sidebar lists finalized orders with tracking IDs and finalize timestamps.

## Nav pages
- **Dashboard** — counts, recent activity, quick entry.
- **All Customers / Wholesale / Retail / Leads / Previous** — filtered customer lists.
- **Hardware Reqs** — all hardware requirements across customers.
- **All Orders / Draft / Pending / In Progress / Completed / Cancelled** — order lifecycle views.
- **Backup & Restore** — create and restore SQLite backups.
- **Settings** — app + database info.

## Where data lives
- **Database**: `data/customer-management.sqlite`
- **Backups**: `backups/backup-YYYY-MM-DDTHH-MM-SS.sqlite`

## Mobile
- Sidebar collapses into a slide-out drawer under 820px.

## Keyboard & accessibility
- **Skip to content** link on Tab from the top.
- Focus trap in dialogs (Tab / Shift+Tab cycles).
- **Esc** closes dialogs.
- Every field has a visible label.
- Statuses use color + text, never color alone.

## Restore caveat
After a restore, the app reloads. If any old data appears, hit **Ctrl+F5** to hard-refresh.

## Acceptance checklist
- [x] Single-file frontend with all views integrated
- [x] Real DB counts on dashboard + sidebar
- [x] Phone save works without additional info
- [x] Duplicate phone returns existing record
- [x] Multi-category assignment
- [x] All timestamps in UTC, displayed in Asia/Karachi with day-of-week
- [x] Multiple products per order, line totals computed server-side
- [x] Unique tracking IDs (`NT-YYYYMMDD-NNNN`)
- [x] Finalization locks price + snapshots customer in a transaction
- [x] Print order summary
- [x] Backup / restore with safety backup before restore
- [x] Search across customers, orders, tracking IDs
- [x] Date filters on lists
- [x] Empty / loading / error states
- [x] Mobile drawer + responsive tables
- [x] Focus trap + skip link + ARIA on dialogs
- [x] Unsaved-changes warning on navigation

## Troubleshooting
| Problem | Fix |
|---|---|
| `better-sqlite3` fails to build | Install "Desktop development with C++" build tools, delete `node_modules`, re-run |
| Port 3000 busy | `set PORT=3001 && node server.js` |
| Browser doesn't open | Visit `http://localhost:3000` |
| Restore then old data appears | Ctrl+F5 or restart the app once |
