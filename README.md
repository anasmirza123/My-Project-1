# Customer Manager

A small local app for saving customer phone numbers, sorting them into categories, and tracking orders with tracking IDs.
It runs on your own computer, stores everything in one SQLite file, and needs no internet after the first install.

## Install and start (Windows)

1. Install **Node.js LTS (version 22 or newer)** from https://nodejs.org (one time).
2. Double-click **`start.bat`**.
   - The first run installs the components (needs internet **once**).
   - Your browser opens at **http://localhost:3000**.
3. To stop: close the black window, or double-click `stop.bat`.

The app refuses to start on Node older than 22 and tells you why. The database component ships ready-made for Windows, so no compiler or Visual Studio is needed.

## Daily use

1. Type a phone number on the Dashboard, press **Enter**. It is saved instantly with the date, time and day.
2. Tap a category (Wholesale / Retail / Lead / Other) if you know it. You can also skip and classify later - the number stays under **Uncategorized**.
3. Open the customer any time to add name, WhatsApp, address, hardware requirements, messages.
4. **+ New order** on a customer: add products, quantities, prices, discount, notes. Save as draft, or **Confirm**.
5. **Finalize order** shows a summary. After you confirm, the app records the exact date/time/day, locks the price, stores a snapshot of the customer's details, and assigns the tracking ID (e.g. `NT-20261021-0001`).
6. **Completed Orders** lists every finalized order (tracking ID, price, finalized date, time, day).

Notes on how things are sorted:
- *Previous Customers* = customers with at least one completed order. *Hardware Requirements* = customers with at least one saved requirement. *Uncategorized* = customers with no category. These three update by themselves; you do not tag them by hand.
- Order states: **draft -> confirmed -> completed**, or **cancelled**. Delivery and payment are tracked separately and can change after the sale is final.
- A number can only be saved once. Typing it in another format (`0300...`, `+92 300...`, `92300...`) finds the existing record instead.

## Where your data is

| What | Where |
|---|---|
| Database | `data\customer-management.sqlite` (inside this folder) |
| Backups | `backups\` (inside this folder) |

Both are shown on the **Backup & Restore** page. Neither folder is reachable from the browser.

## Backup and restore

- **Backup & Restore -> Create backup now** makes a safe, verified copy while the app is running (file name includes the date and time).
- **Settings -> Extra backup folder**: set a USB drive or a synced folder (OneDrive/Google Drive) and every backup is copied there too. *A backup on the same disk does not protect you from disk failure.*
- **Restore** replaces current data with the chosen backup. A safety copy (`before-restore_...`) of the current data is made first, and both files are integrity-checked.
- Manual method: close the app and copy `data\customer-management.sqlite` somewhere safe.

## Using it from a phone (optional, off by default)

By default only this computer can open the app. To use it from a phone on the same Wi-Fi: copy `.env.example` to `.env`, set `HOST=0.0.0.0` **and** `APP_PIN=` to a PIN, restart, then open `http://<this-computer's-IP>:3000` on the phone. Anyone on that Wi-Fi who knows the PIN can then use the app, and the connection is not encrypted - use only on a network you trust.

## Settings

Timezone (default `Asia/Karachi`), currency, tracking prefix (`NT`), extra backup folder. Timestamps are stored in UTC and shown in your timezone.

## Tests

```
npm install
npm test          # 16 backend/API checks on a throw-away database
npm run test:ui   # browser-level walkthrough (jsdom) on a throw-away database
```
Tests never touch your real data.

## Project layout

```
src/        server.js, app.js, db.js, config.js, schema.sql (database + migrations)
src/services/   business logic (customers, orders, tracking, backup, search...)
src/routes/     REST API        src/utils/   phone, money, datetime
public/     the web pages (index.html, css/, js/)
data/  backups/  test/
```

## Known limits

- Single user on one machine. No logins (only the optional PIN).
- A **completed** order cannot be edited or cancelled in the app (price, tracking ID and snapshot are locked by the database). Fixing one needs a deliberate correction workflow, which is not built yet. Payment and delivery status can be changed.
- No automatic WhatsApp reading. Messages are pasted/typed by you. The "open chat" link just opens WhatsApp with that number.
- The tracking ID is internal; it is not connected to any courier.
- Customers are archived (status), never deleted, so history stays intact.
