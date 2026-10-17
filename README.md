# Customer Management and Order Tracking System

A fast, lightweight, and professional customer management and order tracking application designed with an **HTML-first single-file frontend**, a **single-file backend**, and a **persistent local SQLite database**.

---

## Architecture Overview

- **`index.html`**: The entire frontend contained in **ONE single file** with HTML5 semantics, custom CSS variables, responsive styling, and modular vanilla JavaScript.
- **`server.ts`**: Express backend running with persistent SQLite database (`sql.js` / WebAssembly, requiring zero C++ build tools or Python on Windows/Mac/Linux).
- **`data/customer-management.sqlite`**: ACID-compliant SQLite database storing all customers, categories, hardware specs, orders, immutable snapshots, and activity logs.
- **`backups/`**: Automated and on-demand point-in-time database snapshot files.

---

## Quick Start on Windows

### Prerequisites
- **Node.js 18+** installed from [nodejs.org](https://nodejs.org/).

### 1-Click Launch
1. Double-click **`start.bat`**.
2. On first run, it installs dependencies automatically (`npm install`).
3. Your web browser will open immediately at **`http://localhost:3000`**.

### Manual Command Line Launch
```bash
npm install
npm run dev
```

---

## Core Features & Workflow

### 1. Instant Phone Number Capture
- On the Dashboard, type any customer phone number into the prominent input field.
- Press Enter or click **Save**. The customer record is created in SQLite in `<10ms`.
- Secondary details (name, email, city, address, notes) are **100% optional**.
- Duplicate phone numbers are automatically detected without creating split records.

### 2. Multi-Category Management
- Assign accounts to **Wholesale**, **Retail**, **Lead**, or **Other**.
- Multiple categories per customer are fully supported via the normalized `customer_categories` table.
- Accounts with no categories automatically appear under **Uncategorized**.

### 3. Hardware Requirements Tracking
- Register detailed hardware and equipment procurement requests per customer: product name, brand, model, quantities, technical specifications, and budgets in PKR.
- Global hardware view shows all pending client equipment requests across the company.

### 4. Sales Orders & Line Item Management
- Create draft orders linked to customer records.
- Add product line items with unit prices, quantities, and line-specific discounts. Subtotals are calculated dynamically.
- Track Payment Status (`Unpaid`, `Partial`, `Paid in Full`) and Delivery Status (`Pending Dispatch`, `Dispatched`, `Delivered`).

### 5. Atomic Order Finalization & Sequential Tracking IDs
- Clicking **★ Finalize Order** presents a confirmation dialog with total price calculations.
- On confirmation, an atomic transaction:
  1. Generates a guaranteed sequential tracking ID in the format `NT-YYYYMMDD-XXXX`.
  2. Permanently captures an **immutable snapshot** of the customer's name, phone, WhatsApp, and delivery address.
  3. Records the finalization timestamp in the **`Asia/Karachi`** timezone (with day-of-week).
  4. Locks the order against further alterations.

### 6. Point-in-Time Database Backup & Restore
- Go to **Backup & Settings** in the sidebar.
- Click **Create Backup Now** to dump an atomic snapshot of the SQLite database to `backups/backup-YYYY-MM-DD...sqlite`.
- Restore any previous backup with one click. A safety backup of the active database is created automatically prior to restoration.

---

## API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard/stats` | Real-time counts from `v_dashboard_counts` view and recent records |
| `GET` | `/api/customers` | Query customers with search, category, and status filters |
| `POST` | `/api/customers` | Save customer by phone number |
| `GET` | `/api/customers/:id` | Fetch customer dossier and category links |
| `PATCH` | `/api/customers/:id` | Update customer contact fields |
| `PUT` | `/api/customers/:id/categories` | Update customer category assignments |
| `GET` | `/api/customers/:id/hardware` | Fetch hardware requirements for customer |
| `POST` | `/api/customers/:id/hardware` | Add hardware procurement requirement |
| `GET` | `/api/hardware` | List all hardware procurement requirements |
| `POST` | `/api/customers/:id/orders` | Initialize new order draft |
| `GET` | `/api/orders` | Query orders with status and search filters |
| `GET` | `/api/orders/:id` | Fetch full order details and line items |
| `POST` | `/api/orders/:id/items` | Add product line item to order |
| `DELETE` | `/api/orders/:id/items/:itemId` | Delete product line item |
| `POST` | `/api/orders/:id/finalize` | Finalize order, generate tracking ID, snapshot customer |
| `GET` | `/api/search?q=` | Global multi-field search |
| `POST` | `/api/backup` | Create atomic SQLite backup snapshot |
| `POST` | `/api/restore` | Restore database from backup snapshot |
