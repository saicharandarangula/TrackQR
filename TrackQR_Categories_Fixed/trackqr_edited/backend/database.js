const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH 
    ? path.resolve(__dirname, process.env.DB_PATH) 
    : path.join(dataDir, 'inventory.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to connect to SQLite database:', err.message);
    } else {
        console.log(`Connected to SQLite database at: ${dbPath}`);
    }
});

// Seed Initial Data (Matching TrackQR Defaults)
const DEFAULT_SETTINGS = {
    orgName: "GlobalTech Industries",
    currency: "$",
    defaultLowStock: 10,
    soundEnabled: 1,
    autoOpenModal: 0,
    scanCooldown: 2500,
    theme: "light"
};

const ADDITIONAL_DEFAULT_CATEGORIES = [
    { id: "CAT-DEV-6", type: "device", name: "Electronic Items", prefix: "ELE", desc: "Phones, tablets, and other electronic equipment" },
    { id: "CAT-DEV-7", type: "device", name: "Networking Equipment", prefix: "NET", desc: "Routers, switches, access points, and network appliances" },
    { id: "CAT-STK-6", type: "stock", name: "Books & Manuals", prefix: "BOK", desc: "Reference books, training materials, and product manuals" },
    { id: "CAT-STK-7", type: "stock", name: "Electronic Accessories", prefix: "EAC", desc: "Chargers, batteries, and small electronic accessories" },
    { id: "CAT-STK-8", type: "stock", name: "Stationery", prefix: "STA", desc: "Paper, pens, notebooks, and other stationery supplies" }
];

const DEFAULT_CATEGORIES = [
    { id: "CAT-DEV-1", type: "device", name: "Laptops & Notebooks", prefix: "LAP", desc: "Portable computers and mobile workstations" },
    { id: "CAT-DEV-2", type: "device", name: "Monitors & Displays", prefix: "MON", desc: "Color-accurate 4K screens, curved panels, TV displays" },
    { id: "CAT-DEV-3", type: "device", name: "Projectors & AV", prefix: "PRJ", desc: "Conference presentation equipment and audio amplifiers" },
    { id: "CAT-DEV-4", type: "device", name: "Printers & Scanners", prefix: "PRN", desc: "Multifunction network printers, label printers, scanners" },
    { id: "CAT-DEV-5", type: "device", name: "Desktop Workstations", prefix: "DSK", desc: "Tower computers, lab testing rigs, rendering engines" },

    { id: "CAT-STK-1", type: "stock", name: "Cables & Connectors", prefix: "CAB", desc: "HDMI, DisplayPort, USB-C, Cat6 patch cables" },
    { id: "CAT-STK-2", type: "stock", name: "Keyboards & Mice", prefix: "PER", desc: "Wireless mice, ergonomic mechanical keyboards, trackpads" },
    { id: "CAT-STK-3", type: "stock", name: "Adapters & Hubs", prefix: "ADP", desc: "Multiport dongles, USB hubs, power delivery adapters" },
    { id: "CAT-STK-4", type: "stock", name: "Power Supplies & Batteries", prefix: "PWR", desc: "Laptop chargers, surge protectors, backup UPS batteries" },
    { id: "CAT-STK-5", type: "stock", name: "Office Consumables", prefix: "CON", desc: "Printer toner, label rolls, thermal ribbons, cleaning kits" },
    ...ADDITIONAL_DEFAULT_CATEGORIES
];

const DEFAULT_DEVICES = [
    {
        id: "DEV-LAP-001",
        name: "MacBook Pro 16 M2 Max",
        category: "Laptops & Notebooks",
        serial: "C02XYZ123ABC",
        location: "Floor 3 - Engineering Lab",
        assignedTo: "Sarah Jenkins",
        department: "Engineering",
        purchaseDate: "2024-03-15",
        cost: 2499,
        condition: "Good",
        status: "In Use",
        notes: "Configured with 32GB RAM, 1TB SSD. Assigned for iOS deployment."
    },
    {
        id: "DEV-LAP-002",
        name: "Dell XPS 15 9530",
        category: "Laptops & Notebooks",
        serial: "DL-987412X",
        location: "IT Storage Room B",
        assignedTo: "",
        department: "IT Infrastructure",
        purchaseDate: "2024-05-10",
        cost: 1899,
        condition: "New",
        status: "Available",
        notes: "Freshly re-imaged with Windows 11 Enterprise. Ready for new hire issue."
    },
    {
        id: "DEV-MON-001",
        name: "Dell UltraSharp 27 4K (U2720Q)",
        category: "Monitors & Displays",
        serial: "CN-0U2720-991",
        location: "Design Studio - Desk 4",
        assignedTo: "Marcus Chen",
        department: "Product Design",
        purchaseDate: "2023-11-20",
        cost: 580,
        condition: "Good",
        status: "In Use",
        notes: "Color calibrated 99% DCI-P3 for UI/UX product design team."
    },
    {
        id: "DEV-MON-002",
        name: "LG 34 Curved Ultrawide (34WN80C)",
        category: "Monitors & Displays",
        serial: "LG34WP-4421",
        location: "Finance Office 202",
        assignedTo: "Facilities Support",
        department: "Finance",
        purchaseDate: "2024-01-18",
        cost: 720,
        condition: "Needs Repair",
        status: "Under Maintenance",
        notes: "DisplayPort input flickers intermittently. Diagnostic in progress."
    },
    {
        id: "DEV-PRJ-001",
        name: "Epson PowerLite 2250U 5000L",
        category: "Projectors & AV",
        serial: "EP-PL2250-801",
        location: "Conference Room Alpha",
        assignedTo: "Facilities Team",
        department: "Operations",
        purchaseDate: "2023-08-14",
        cost: 1250,
        condition: "Good",
        status: "In Use",
        notes: "Ceiling mounted projector with wireless HDMI presentation gateway."
    },
    {
        id: "DEV-PRJ-002",
        name: "BenQ Wireless Meeting Projector",
        category: "Projectors & AV",
        serial: "BQ-MW535A",
        location: "AV Storage Locker 2",
        assignedTo: "",
        department: "Operations",
        purchaseDate: "2024-02-01",
        cost: 890,
        condition: "Good",
        status: "Available",
        notes: "Portable presentation projector equipped with travel carry case."
    },
    {
        id: "DEV-PRN-001",
        name: "HP LaserJet Enterprise MFP M528",
        category: "Printers & Scanners",
        serial: "HP-MFP528-552",
        location: "Floor 2 Copy Center",
        assignedTo: "Shared Office",
        department: "General Admin",
        purchaseDate: "2023-06-11",
        cost: 1650,
        condition: "Fair",
        status: "In Use",
        notes: "High capacity departmental laser printer and document scanner."
    },
    {
        id: "DEV-DSK-001",
        name: "Lenovo ThinkStation P360 Tower",
        category: "Desktop Workstations",
        serial: "LEN-P360-9941",
        location: "Server Room Testing Rig 1",
        assignedTo: "DevOps Team",
        department: "Engineering",
        purchaseDate: "2023-10-04",
        cost: 2100,
        condition: "Good",
        status: "In Use",
        notes: "Configured with RTX A4000 GPU for automated build runner pipelines."
    }
];

const DEFAULT_STOCK = [
    {
        id: "STK-CAB-001",
        name: "Cat6 Ethernet Patch Cable 3m (Snagless)",
        category: "Cables & Connectors",
        quantity: 45,
        minLevel: 15,
        unit: "pcs",
        location: "Warehouse Bin B-14",
        unitPrice: 4.50,
        supplier: "Monoprice Direct",
        notes: "Molded RJ45 connectors, high bandwidth gigabit rated."
    },
    {
        id: "STK-CAB-002",
        name: "High-Speed HDMI 2.1 4K Cable 2m",
        category: "Cables & Connectors",
        quantity: 8,
        minLevel: 10,
        unit: "pcs",
        location: "Warehouse Bin B-16",
        unitPrice: 9.00,
        supplier: "Anker Official",
        notes: "Braided 48Gbps ultra high speed cable."
    },
    {
        id: "STK-PER-001",
        name: "Logitech M185 Wireless Optical Mouse",
        category: "Keyboards & Mice",
        quantity: 24,
        minLevel: 8,
        unit: "pcs",
        location: "IT Supply Closet Shelf 1",
        unitPrice: 14.50,
        supplier: "Logitech Commercial",
        notes: "Includes AA battery and nano USB receiver."
    },
    {
        id: "STK-PER-002",
        name: "Dell QuietKey USB Wired Keyboard (KB216)",
        category: "Keyboards & Mice",
        quantity: 0,
        minLevel: 10,
        unit: "pcs",
        location: "IT Supply Closet Shelf 2",
        unitPrice: 18.00,
        supplier: "Dell Direct",
        notes: "Standard full size layout with numeric keypad."
    },
    {
        id: "STK-ADP-001",
        name: "USB-C to Dual HDMI 4K Display Adapter",
        category: "Adapters & Hubs",
        quantity: 6,
        minLevel: 8,
        unit: "pcs",
        location: "Accessories Cabinet 3",
        unitPrice: 32.00,
        supplier: "Satechi Partner",
        notes: "Supports dual 4K 60Hz monitor output from modern laptops."
    },
    {
        id: "STK-PWR-001",
        name: "Universal 100W USB-C GaN Laptop Charger",
        category: "Power Supplies & Batteries",
        quantity: 14,
        minLevel: 5,
        unit: "pcs",
        location: "IT Supply Closet Shelf 3",
        unitPrice: 42.00,
        supplier: "Baseus Tech",
        notes: "Power Delivery 3.0 certified fast charger with 2m cable."
    },
    {
        id: "STK-PWR-002",
        name: "Heavy-Duty 6-Outlet Surge Protector 3m",
        category: "Power Supplies & Batteries",
        quantity: 19,
        minLevel: 6,
        unit: "pcs",
        location: "Warehouse Bin C-02",
        unitPrice: 16.50,
        supplier: "APC Schneider",
        notes: "1080 Joules surge suppression rating with safety shutters."
    },
    {
        id: "STK-CON-001",
        name: "Dymo Thermal Asset Barcode Label Rolls",
        category: "Office Consumables",
        quantity: 12,
        minLevel: 4,
        unit: "rolls",
        location: "Labeling Station Drawer",
        unitPrice: 11.20,
        supplier: "Dymo Direct",
        notes: "Self-adhesive durable synthetic tags, 250 labels per roll."
    }
];

const DEFAULT_STOCK_TXNS = [
    {
        id: "TXN-001",
        stockId: "STK-CAB-001",
        stockName: "Cat6 Ethernet Patch Cable 3m (Snagless)",
        type: "Stock-In",
        quantity: 50,
        previousQty: 0,
        newQty: 50,
        reference: "Initial Bulk Purchase PO-8801",
        performedBy: "Admin",
        timestamp: new Date(Date.now() - 3600000 * 72).toISOString(),
        notes: "Restocked into Warehouse Bin B-14"
    },
    {
        id: "TXN-002",
        stockId: "STK-CAB-001",
        stockName: "Cat6 Ethernet Patch Cable 3m (Snagless)",
        type: "Stock-Out",
        quantity: 5,
        previousQty: 50,
        newQty: 45,
        reference: "Floor 3 Workstation Cabling Setup",
        performedBy: "Admin",
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
        notes: "Issued to Network Operations Team"
    },
    {
        id: "TXN-003",
        stockId: "STK-PER-002",
        stockName: "Dell QuietKey USB Wired Keyboard (KB216)",
        type: "Stock-Out",
        quantity: 10,
        previousQty: 10,
        newQty: 0,
        reference: "Computer Lab 4 Upgrade Project",
        performedBy: "Admin",
        timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
        notes: "Item now out of stock; reorder pending."
    },
    {
        id: "TXN-004",
        stockId: "STK-ADP-001",
        stockName: "USB-C to Dual HDMI 4K Display Adapter",
        type: "Stock Return",
        quantity: 2,
        previousQty: 4,
        newQty: 6,
        reference: "Returned by Marketing Team",
        performedBy: "Admin",
        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        notes: "Items inspected and returned to storage in pristine condition."
    }
];

const DEFAULT_MAINTENANCE = [
    {
        id: "MNT-001",
        deviceId: "DEV-MON-002",
        title: "DisplayPort Flickering & Inverter Repair",
        type: "Repair",
        scheduledDate: "2026-10-30",
        completedDate: "",
        status: "In Progress",
        cost: 85,
        technician: "Apex Display Repair Services",
        notes: "Investigating power board voltage fluctuations and capacitor wear."
    },
    {
        id: "MNT-002",
        deviceId: "DEV-PRJ-001",
        title: "Projector Lamp Replacement & Optical Cleaning",
        type: "Preventive",
        scheduledDate: "2026-09-15",
        completedDate: "2026-09-16",
        status: "Completed",
        cost: 180,
        technician: "In-House AV Team",
        notes: "Replaced lamp bulb after 3,000 runtime hours. Air intake filter washed."
    },
    {
        id: "MNT-003",
        deviceId: "DEV-LAP-002",
        title: "Annual Thermal Paste & Battery Health Check",
        type: "Inspection",
        scheduledDate: "2026-11-10",
        completedDate: "",
        status: "Scheduled",
        cost: 50,
        technician: "IT Helpdesk",
        notes: "Standard bi-annual hardware checkup prior to re-assignment."
    }
];

const DEFAULT_LOGS = [
    {
        id: "LOG-001",
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        category: "QR Scanned",
        type: "QR Scanned",
        title: "QR Tag Scanned",
        details: "Scanned device DEV-LAP-001 via camera scanner.",
        user: "Admin"
    },
    {
        id: "LOG-002",
        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        category: "Stock",
        type: "Stock Return",
        title: "Stock Return Processed",
        details: "Returned 2 units of USB-C to Dual HDMI 4K Display Adapter (STK-ADP-001).",
        user: "Admin"
    },
    {
        id: "LOG-003",
        timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
        category: "Stock",
        type: "Stock-Out",
        title: "Stock-Out Issued",
        details: "Issued 10 units of Dell Keyboard (STK-PER-002) for Computer Lab 4.",
        user: "Admin"
    },
    {
        id: "LOG-004",
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
        category: "Maintenance",
        type: "Maintenance",
        title: "Maintenance Scheduled",
        details: "Scheduled repair ticket MNT-001 for DEV-MON-002.",
        user: "Admin"
    },
    {
        id: "LOG-005",
        timestamp: new Date(Date.now() - 3600000 * 48).toISOString(),
        category: "Device",
        type: "Device Created",
        title: "New Device Registered",
        details: "Registered MacBook Pro 16 (DEV-LAP-001) in Engineering.",
        user: "Admin"
    }
];

// Helper wrapper for async queries
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function initDatabase() {
    await run('PRAGMA foreign_keys = ON;');
    await run('PRAGMA journal_mode = WAL;');

    // 1. Settings Table
    await run(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            orgName TEXT NOT NULL DEFAULT 'GlobalTech Industries',
            currency TEXT NOT NULL DEFAULT '$',
            defaultLowStock INTEGER NOT NULL DEFAULT 10,
            soundEnabled INTEGER NOT NULL DEFAULT 1,
            autoOpenModal INTEGER NOT NULL DEFAULT 0,
            scanCooldown INTEGER NOT NULL DEFAULT 2500,
            theme TEXT NOT NULL DEFAULT 'light'
        )
    `);

    // 2. Categories Table
    await run(`
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('device', 'stock')),
            name TEXT NOT NULL,
            prefix TEXT NOT NULL,
            desc TEXT DEFAULT '',
            UNIQUE(type, prefix),
            UNIQUE(type, name)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 3. Devices Table (Serialized Physical Assets)
    await run(`
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            serial TEXT NOT NULL UNIQUE,
            location TEXT NOT NULL,
            assignedTo TEXT DEFAULT '',
            department TEXT DEFAULT '',
            purchaseDate TEXT NOT NULL,
            cost REAL DEFAULT 0,
            condition TEXT DEFAULT 'Good',
            status TEXT DEFAULT 'Available',
            notes TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 4. Stock Table (Quantity-based Consumables & Accessories)
    await run(`
        CREATE TABLE IF NOT EXISTS stock (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
            minLevel INTEGER NOT NULL DEFAULT 5,
            unit TEXT NOT NULL DEFAULT 'pcs',
            location TEXT NOT NULL,
            unitPrice REAL DEFAULT 0,
            supplier TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 5. Stock Transactions Table (Ledger of movements)
    await run(`
        CREATE TABLE IF NOT EXISTS stock_transactions (
            id TEXT PRIMARY KEY,
            stockId TEXT NOT NULL,
            stockName TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('Stock-In', 'Stock-Out', 'Stock Return')),
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            previousQty INTEGER NOT NULL,
            newQty INTEGER NOT NULL,
            reference TEXT DEFAULT '',
            performedBy TEXT DEFAULT 'Admin',
            timestamp TEXT NOT NULL,
            notes TEXT DEFAULT '',
            FOREIGN KEY (stockId) REFERENCES stock(id) ON DELETE CASCADE
        )
    `);

    // 6. Maintenance Tickets Table
    await run(`
        CREATE TABLE IF NOT EXISTS maintenance (
            id TEXT PRIMARY KEY,
            deviceId TEXT NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'Repair',
            scheduledDate TEXT NOT NULL,
            completedDate TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Scheduled',
            cost REAL DEFAULT 0,
            technician TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (deviceId) REFERENCES devices(id) ON DELETE CASCADE
        )
    `);

    // 7. Activity Logs Table
    await run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            category TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            details TEXT NOT NULL,
            user TEXT DEFAULT 'Admin'
        )
    `);

    // Check count of devices
    const row = await get(`SELECT COUNT(*) as count FROM devices`);
    if (row && row.count === 0) {
        console.log('Database empty. Seeding initial data sequentially...');

        await run(
            `INSERT OR REPLACE INTO settings (id, orgName, currency, defaultLowStock, soundEnabled, autoOpenModal, scanCooldown, theme) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
            [DEFAULT_SETTINGS.orgName, DEFAULT_SETTINGS.currency, DEFAULT_SETTINGS.defaultLowStock, DEFAULT_SETTINGS.soundEnabled, DEFAULT_SETTINGS.autoOpenModal, DEFAULT_SETTINGS.scanCooldown, DEFAULT_SETTINGS.theme]
        );

        for (const c of DEFAULT_CATEGORIES) {
            await run(`INSERT OR IGNORE INTO categories (id, type, name, prefix, desc) VALUES (?, ?, ?, ?, ?)`, [c.id, c.type, c.name, c.prefix, c.desc]);
        }

        for (const d of DEFAULT_DEVICES) {
            await run(
                `INSERT OR IGNORE INTO devices (id, name, category, serial, location, assignedTo, department, purchaseDate, cost, condition, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [d.id, d.name, d.category, d.serial, d.location, d.assignedTo, d.department, d.purchaseDate, d.cost, d.condition, d.status, d.notes]
            );
        }

        for (const s of DEFAULT_STOCK) {
            await run(
                `INSERT OR IGNORE INTO stock (id, name, category, quantity, minLevel, unit, location, unitPrice, supplier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [s.id, s.name, s.category, s.quantity, s.minLevel, s.unit, s.location, s.unitPrice, s.supplier, s.notes]
            );
        }

        for (const t of DEFAULT_STOCK_TXNS) {
            await run(
                `INSERT OR IGNORE INTO stock_transactions (id, stockId, stockName, type, quantity, previousQty, newQty, reference, performedBy, timestamp, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [t.id, t.stockId, t.stockName, t.type, t.quantity, t.previousQty, t.newQty, t.reference, t.performedBy, t.timestamp, t.notes]
            );
        }

        for (const m of DEFAULT_MAINTENANCE) {
            await run(
                `INSERT OR IGNORE INTO maintenance (id, deviceId, title, type, scheduledDate, completedDate, status, cost, technician, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [m.id, m.deviceId, m.title, m.type, m.scheduledDate, m.completedDate, m.status, m.cost, m.technician, m.notes]
            );
        }

        for (const l of DEFAULT_LOGS) {
            await run(
                `INSERT OR IGNORE INTO activity_logs (id, timestamp, category, type, title, details, user) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [l.id, l.timestamp, l.category, l.type, l.title, l.details, l.user]
            );
        }

        console.log('Database initial seed complete!');
    }

    const categoryMigration = 'additional-default-categories-v1';
    const appliedCategoryMigration = await get(
        `SELECT id FROM schema_migrations WHERE id = ?`,
        [categoryMigration]
    );
    if (!appliedCategoryMigration) {
        for (const category of ADDITIONAL_DEFAULT_CATEGORIES) {
            const existing = await get(
                `SELECT id FROM categories WHERE type = ? AND name = ?`,
                [category.type, category.name]
            );
            if (existing) continue;

            const typeCode = category.type === "device" ? "DEV" : "STK";
            const categoryIds = await query(`SELECT id FROM categories WHERE type = ?`, [category.type]);
            let nextNumber = 1;
            for (const existingCategory of categoryIds) {
                const match = existingCategory.id.match(new RegExp(`^CAT-${typeCode}-(\\d+)$`));
                if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
            }

            await run(
                `INSERT OR IGNORE INTO categories (id, type, name, prefix, desc) VALUES (?, ?, ?, ?, ?)`,
                [`CAT-${typeCode}-${nextNumber}`, category.type, category.name, category.prefix, category.desc]
            );
        }
        await run(`INSERT INTO schema_migrations (id) VALUES (?)`, [categoryMigration]);
    }

    // One-time repair: older versions renamed a category without updating the items
    // that used it, leaving devices/stock pointing at a category name that no longer
    // exists (they then vanish from category counts and filters). Re-link each such
    // item to the single category whose name starts with / is contained in the old
    // name (e.g. "Laptops & Notebooks" -> "Laptops"). Ambiguous cases are left alone.
    const orphanMigration = 'repair-orphan-item-categories-v1';
    const appliedOrphanMigration = await get(`SELECT id FROM schema_migrations WHERE id = ?`, [orphanMigration]);
    if (!appliedOrphanMigration) {
        for (const [type, table] of [['device', 'devices'], ['stock', 'stock']]) {
            const defined = await query(`SELECT name FROM categories WHERE type = ?`, [type]);
            const definedNames = new Set(defined.map(c => c.name));
            const used = await query(`SELECT DISTINCT category FROM ${table}`);
            for (const { category } of used) {
                if (definedNames.has(category)) continue;
                const old = String(category || '').toLowerCase();
                const matches = defined.filter(c => {
                    const n = c.name.toLowerCase();
                    return old.startsWith(n) || n.startsWith(old);
                });
                if (matches.length === 1) {
                    await run(`UPDATE ${table} SET category = ?, updatedAt = CURRENT_TIMESTAMP WHERE category = ?`, [matches[0].name, category]);
                    console.log(`Repaired ${table}: "${category}" -> "${matches[0].name}"`);
                } else {
                    console.warn(`Could not auto-repair ${table} category "${category}" (${matches.length} matches). Re-assign it manually.`);
                }
            }
        }
        await run(`INSERT INTO schema_migrations (id) VALUES (?)`, [orphanMigration]);
    }
}

module.exports = {
    db,
    initDatabase,
    query,
    get,
    run
};
