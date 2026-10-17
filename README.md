# Anas Management System (Local, Windows)

Save a phone number in one step, organise customers (Wholesale / Retail / Lead), track hardware
requirements, build orders, record payments, purchase cost and profit, finalize with a unique
tracking ID. Everything is stored in a local SQLite file on your own computer.

## Files
- `index.html`  - the whole frontend (HTML + CSS + JavaScript, no internet needed)
- `server.js`   - local backend (Express + SQLite via sql.js, no C++ build tools needed)
- `package.json`, `start.bat`, `README.md`
- `data/customer-management.sqlite` - your database (created on first run)
- `backups/` - backup snapshots

## Start
1. Install Node.js 18 or newer from https://nodejs.org/
2. Double-click `start.bat` (first run installs dependencies - internet needed once).
3. Your browser opens at http://localhost:3000. Keep the black window open while you work.

The server listens on `localhost` only, so other devices on your network cannot reach it.

## Sample data (optional)
A fresh install starts empty. To try the app with demo records, run in this folder:
`set SEED_SAMPLE_DATA=1 && npm start` (use a separate copy of the folder, not your real one).

## Backup and restore
- Sidebar -> **Backup & Restore** -> *Create Backup Now*. Files go to `backups/`.
- Restoring first saves a safety copy of your current data, then switches to the chosen backup.
- To be extra safe, copy the `data` and `backups` folders to a USB drive regularly.

## Rules the app follows
- Money is stored as whole paisa (integers). Currency default: PKR. Time zone: Asia/Karachi.
- Amount Received = confirmed payments - refunds. Remaining Balance = Total Sale - Amount Received.
- Payments and refunds are never deleted; corrections are logged in the activity history.
- A finalized order keeps a snapshot of the customer's details and its tracking ID (NT-YYYYMMDD-0001).

## Pages (sidebar)
Dashboard, Order Register, customers by category, Hardware Requirements, All / Pending / In Progress / Completed
orders, Add Customer, Customer Categories (add, rename, safe delete), Payments, Expenses, Reports & Analytics
(10 reports, date filter, CSV download), Activity History, Backup & Restore, Settings (business name,
tracking prefix, currency code).

## Known limitations
- Not yet separate pages: "Add Order" (create from a customer profile or the Order Register button) and
  "Products and Purchase Costs" (see Reports -> Product purchase cost report).
- Payment status labels "Refund Pending" and "Payment Review", and a delivery-status filter, are not implemented.
- Time zone is fixed to Asia/Karachi; the Settings page changes name, tracking prefix and currency code only.
- Dashboard "Today / This month" ranges use UTC dates, so they can differ from Karachi dates around midnight.

## Register labels (v1.2.1)
Order Register columns now read: Amount (Customer ne diya) and Khareed (Hamari Cost). If a cost is not entered the cell shows "Cost not entered" (never Rs. 0).

## Troubleshooting: "Failed to load dashboard: Request error (404)"
The app calls `GET /api/dashboard/stats` on the same address the page was opened from. That route exists in `server.js`, and the server always answers API errors as JSON with a message. A bare "Request error (404)" means the reply was NOT from this server (e.g. the page was opened through Live Server / a static server / `file://`, an old project or another program holds port 3000). Fix: close other servers, run `start.bat`, open http://localhost:3000. Run `npm run diagnose` to see which program answers. Details of every route: `API.md`.

## Database
SQLite file `data/customer-management.sqlite` (created on first start, never reset automatically, foreign keys on). Migration history is recorded in table `schema_migrations`. Backup: Backup & Restore page (files in `backups/`). Manual restore: stop the app, copy a backup over the data file, start again.

## Follow-ups and Next Visit (v1.3.0)
- When you set an order to **Completed**, a prompt offers: Schedule Next Visit, Create follow-up, customer profile, open order, purchase history, or Skip. Completing never creates or completes a follow-up by itself and never changes payment status.
- **Follow-ups** page (sidebar): filter Due today / Overdue / Upcoming / Completed; each row shows previous purchase, tracking ID, paid, balance, next visit, type and purpose. The ⋮ menu has Call (opens your phone app only - nothing is dialled by the app), customer, order, record payment, reschedule, complete, cancel. Types: Next Visit, New Order, Payment Collection, Product Requirement, Customer Check-in, Delivery Follow-up, Other.
- Overdue / Due Today are calculated from the date in Asia/Karachi; the dashboard shows the counts and today's/overdue visits (cards link to the filtered list).
- **Purchase History** lists completed orders, one row per order (it is derived from orders, so an order cannot be counted twice). Missing costs show "Cost not entered" / "Profit unavailable".
- Tests: `npm test` runs `test-followups.js` (Node 22+ only for this test) against a real SQLite database.

## Not built yet
Auto-save with Saved/Saving/Failed states and Retry, clickable dashboard cards for the older statistics, kebab menus on the older tables, a dedicated Add Order page, Refund Pending / Payment Review statuses, delivery-status filter.
