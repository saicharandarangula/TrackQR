# TrackQR – QR-Based Inventory & Asset Tracker

A complete, full-stack, enterprise-grade QR-powered inventory and asset tracking web application. Features live camera QR scanning, high-resolution printable QR passport tags, hardware device tracking with unique serial validation, quantity-based stock consumable management with transaction ledgers, maintenance work orders, activity audit logs, and persistent SQLite database storage connected to a Node.js/Express REST API.

---

## ✨ User-Friendly Refresh

This version keeps the existing TrackQR functionality but refreshes the experience with a bright, clean interface designed for normal users instead of an admin-heavy dark dashboard.

- Dashboard greeting is simply **Welcome**.
- Bright white/blue visual system with clearer spacing, cards, buttons, forms, and mobile behavior.
- QR passport opens immediately after creating a new device or stock item, so the user can see/download the QR without searching.
- Category changes now safely update existing inventory records when a category is renamed.
- Category names/prefixes are validated during editing to prevent duplicate taxonomy entries.
- Added PWA install support (`manifest.json` + `sw.js`) as groundwork for the later Android/Play Store conversion.

## 🌟 Key Features

- **Full-Stack Architecture**: Modern responsive frontend connected to a Node.js/Express backend with persistent SQLite storage (no localStorage dependency for primary data).
- **Physical Device Tracking**: Serialized assets (e.g., Laptops, Monitors, Workstations) with status lifecycle, location, condition, and strict duplicate serial number rejection.
- **Stock & Consumable Management**: Quantity-based inventory with real-time stock levels, min-level reorder thresholds, and zero-inventory alerts.
- **Stock Movement Ledger**: Immutable transaction history (Stock-In, Stock-Out, Returns) preventing negative inventory balances.
- **QR Code Generation & Print Tags**: Dynamic client-side QR generation encoding permanent Asset IDs, high-resolution 600x760 PNG download, and printable sticker tags via CSS `@media print`.
- **Camera QR Code Scanner**: Live webcam scanner via `Html5Qrcode` with dual-entity discrimination (detects Devices vs. Stock items automatically), cooldown throttling, and drag-and-drop image file decoding.
- **Maintenance Work Orders**: Track repairs, inspections, scheduled servicing dates, technician notes, and expenses with automatic asset status synchronization.
- **Audit Activity Trail**: Comprehensive chronological logging of all asset registrations, movements, edits, scans, and system settings.
- **Data Portability**: Full JSON database backup export & restore, demo data resets, and CSV report downloads.

---

## 📋 Prerequisites

- **Node.js**: Version 18.x or newer (Tested on Node.js v24)
- **npm**: Version 9.x or newer (Included with Node.js)
- Modern web browser (Chrome, Edge, Firefox, Safari)

> [!NOTE]
> **Camera Access Requirements**: Modern web browsers require a **secure context** (`http://localhost` or `https://`) to grant webcam access via `navigator.mediaDevices.getUserMedia`. Running the app on `localhost:5000` satisfies this requirement.

---

## 🚀 Quick Start & Installation

### 1. Install Backend Dependencies
In the project root, open your terminal and run:
```bash
cd backend
npm install
```

### 2. Configure Environment (Optional)
The system automatically defaults to port `5000` and creates an SQLite database at `backend/data/inventory.db`. You can customize settings in `.env`:
```env
PORT=5000
NODE_ENV=development
DB_PATH=./data/inventory.db
```

### 3. Start the Server
From the project root:
```bash
node backend/server.js
```
*Or using npm:*
```bash
cd backend
npm start
```

### 4. Open in Your Browser
Open: **[http://localhost:5000](http://localhost:5000)**

---

## 🛠️ REST API Documentation

### Health & Dashboard
- `GET /api/health` - Server health status and timestamp
- `GET /api/dashboard/stats` - Total asset counts, stock alerts, and maintenance summaries

### Devices (Hardware Assets)
- `GET /api/devices` - List devices (supports `search`, `category`, `status`, `condition`, `sort`)
- `GET /api/devices/:id` - Fetch single device with its maintenance history
- `POST /api/devices` - Register new device (enforces unique serial number and asset ID)
- `PUT /api/devices/:id` - Update device details
- `PATCH /api/devices/:id/status` - Transition device status (`Available`, `In Use`, `Under Maintenance`)
- `DELETE /api/devices/:id` - Remove device and associated maintenance tickets

### Stock Consumables & Movements
- `GET /api/stock` - List stock items (supports `search`, `category`, `level`, `sort`)
- `GET /api/stock/:id` - Fetch single stock item with its movement transaction history
- `POST /api/stock` - Catalog new stock consumable
- `PUT /api/stock/:id` - Update stock details
- `DELETE /api/stock/:id` - Remove stock item
- `POST /api/stock/movement` - Execute `Stock-In`, `Stock-Out`, or `Stock Return`
- `GET /api/stock/transactions/all` - Complete transaction ledger

### Maintenance Work Orders
- `GET /api/maintenance` - List work orders
- `POST /api/maintenance` - Schedule repair or preventive maintenance ticket
- `PUT /api/maintenance/:id` - Update maintenance ticket details
- `DELETE /api/maintenance/:id` - Delete maintenance ticket

### QR Code Recognition & Lookup
- `GET /api/qr/lookup/:code` - Identify any Device ID, Serial Number, or Stock ID in real time

### Categories & Settings
- `GET /api/categories` - List all classification categories
- `POST /api/categories` - Add category with custom prefix
- `PUT /api/categories/:id` - Edit category
- `DELETE /api/categories/:id` - Delete category (protected against in-use items)
- `GET /api/settings` - System organization branding & scanner parameters
- `PUT /api/settings` - Update organization preferences

### Data Portability
- `GET /api/backup/export` - Export full database to JSON
- `POST /api/backup/restore` - Restore full database from JSON

---

## 🧪 Running Automated Tests

Run the included end-to-end integration test suite:
```bash
node scratch/api_test.js
```
*(Ensure `node backend/server.js` is running on port 5000)*

---

## 📊 Feature Verification Checklist

| Feature | Description | Status |
| :--- | :--- | :---: |
| **Backend & SQLite DB** | Express REST API connected to persistent SQLite database with auto-seeding | **PASS** ✅ |
| **Dashboard Statistics** | Real-time counts for Total Devices, In Use, Maintenance, Stock SKUs, Alerts | **PASS** ✅ |
| **Device Management** | Full CRUD for serialized devices with search, multi-field filtering, sorting | **PASS** ✅ |
| **Duplicate Serial Check** | Database UNIQUE constraint + API validation rejecting duplicate serial numbers | **PASS** ✅ |
| **Stock Management** | Catalog consumables, unit pricing, safety levels, and low/out-of-stock badges | **PASS** ✅ |
| **Stock Movement Ledger** | Stock-In, Stock-Out, and Returns with balance calculations and over-issue protection | **PASS** ✅ |
| **QR Code Generation** | Unique QR codes encoding Asset IDs rendered via QRCode.js | **PASS** ✅ |
| **QR PNG & Print Tags** | 600x760 branded PNG tag generator and `@media print` physical tag layout | **PASS** ✅ |
| **Camera QR Scanner** | Live webcam scanning via `Html5Qrcode` + dual entity discriminator + file dropzone | **PASS** ✅ |
| **Maintenance Tracking** | Ticket scheduling, cost logging, completion tracking, and device status sync | **PASS** ✅ |
| **Activity Audit Logs** | Comprehensive audit trail of all CRUD events, movements, and scans with CSV export | **PASS** ✅ |
| **Category Management** | Custom category prefix definitions with in-use deletion protection | **PASS** ✅ |
| **Data Persistence** | Survives browser refresh and server restarts via persistent SQLite database | **PASS** ✅ |
| **Theme & Responsiveness**| Light/Dark mode toggle and responsive mobile drawer navigation | **PASS** ✅ |


## 📱 Web App → Android / Play Store Path

The project is now PWA-ready, but **PWA readiness alone does not publish an Android app to Google Play**.

Recommended next step:
1. Deploy the Node/Express backend to a public HTTPS server.
2. Host the frontend on HTTPS with the API base configured to the public backend.
3. Test QR scanning from an Android phone.
4. Package the web app as an Android application using **Capacitor** (recommended for this project) or a Trusted Web Activity.
5. Build a signed Android App Bundle (`.aab`).
6. Create the Google Play Console listing and submit the `.aab` for review.

For the Play Store version, the SQLite backend should remain on a server; the Android app should not depend on a local `localhost:5000` backend.


## TrackQR Bright UI Version

This version keeps the existing TrackQR functionality and adds a bright, user-friendly blue/white interface.

### Main flow
1. Add a device or stock item.
2. Assign its category and unique ID.
3. Generate the item's QR code.
4. Print/download the QR code and attach it to the physical item.
5. Scan the QR code to open the item's record.
6. Edit, move, maintain, or delete the item from the dashboard.

### Categories
Category names and prefixes are validated. When a category is renamed, existing devices/stock records using the old category name are updated to the new name.

### Run locally
From the `trackqr_edited` folder:

```bash
npm install
npm start
```

Then open:

`http://localhost:5000`

The backend serves the frontend and API from the same application, so this is the simplest way to test the complete system.
