# Garment Management System

A local, browser-based system for a garment business: it sorts the customers who message you on WhatsApp,
logs every chat and order, tracks stock, and shows a daily dashboard (chats today vs yesterday, orders,
and why customers did not order).

## Run it

You need Node.js 16 or newer. No `npm install` is needed.

```bash
cd garment-ms
node server.js
```

The app opens in your browser at **http://localhost:3003** (if it does not open by itself, type that address in).
Keep the terminal window open while you use the app. Press Ctrl+C to stop it.

## Daily use

1. **Save a number.** Type the phone number in the box at the top and press Enter. It is saved instantly,
   duplicates are caught, and today's chat is logged.
2. **Pick the customer type.** Wholesale, Reseller, Retail, Active lead, No response or Other.
   Name, address and other contact are optional.
3. **Sub-category and products.** Create sub-categories (for example Jackton, Shilwar) under
   *Products and stock*, add products to them, then choose the sub-category and the products a customer wants.
4. **Log the chat.** Choose Still chatting / Ordered / No order / No response. For "No order", pick a reason
   (out of stock, sizing issue, upgraded version unavailable...). Add a follow-up date if you want a reminder.
5. **Add an order.** Items, quantity, price, tracking ID, courier and delivery address. Stock goes down
   automatically; cancelling or deleting an order puts it back.
6. **Check the dashboard.** Chats and orders compared with yesterday, the split between wholesalers, resellers,
   no-response and active leads, the lost-order reasons, a 7-day chart, due follow-ups and low stock.

Other pages: **Orders** (search, filters, CSV export of names, phones and addresses), **Follow-ups**
(one-click WhatsApp reminder), **Stock report** (started with / received / sold / left for any date range),
**Settings and backup** (lost reasons, WhatsApp message templates, backup and restore).

## Your data

Everything is stored in `data/db.json`. A copy is saved automatically once a day in `data/backups/`
(the last 30 are kept). You can also download or restore a backup from *Settings and backup*.

## Changing the port or opening it from a phone

Open `server.js` and edit the lines near the top:

```js
const PORT = 3003;
const HOST = '127.0.0.1';   // change to '0.0.0.0' to open it from a phone on the same Wi-Fi
```

There is no password, so only use `0.0.0.0` on a network you trust.
