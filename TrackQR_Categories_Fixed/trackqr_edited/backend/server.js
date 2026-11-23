require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, query, get, run } = require('./database');

// Make sure an item's category really exists for that module (device/stock),
// so records can never point at a category that isn't in the Categories list.
async function categoryExists(type, name) {
    const row = await get(`SELECT id FROM categories WHERE type = ? AND name = ?`, [type, String(name || '').trim()]);
    return !!row;
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Serve frontend static files
const frontendDir = path.resolve(__dirname, '../frontend');
app.use(express.static(frontendDir));

// Helper log function
async function logActivity(category, type, title, details, user = 'Admin') {
    try {
        const id = 'LOG-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
        const timestamp = new Date().toISOString();
        await run(
            `INSERT INTO activity_logs (id, timestamp, category, type, title, details, user) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, timestamp, category, type, title, details, user]
        );
    } catch (e) {
        console.error('Failed to write activity log:', e.message);
    }
}

// ============================================================================
// 1. HEALTH & DASHBOARD STATS
// ============================================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const devices = await query(`SELECT * FROM devices`);
        const stock = await query(`SELECT * FROM stock`);
        const maintenance = await query(`SELECT * FROM maintenance`);
        const recentTxns = await query(`SELECT * FROM stock_transactions ORDER BY timestamp DESC LIMIT 6`);
        const recentActivity = await query(`SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 10`);

        const totalDevices = devices.length;
        const availableDevices = devices.filter(d => d.status === 'Available').length;
        const inUseDevices = devices.filter(d => d.status === 'In Use').length;
        const maintDevices = devices.filter(d => d.status === 'Under Maintenance').length;

        const totalStockItems = stock.length;
        const totalStockUnits = stock.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
        const lowStockCount = stock.filter(s => s.quantity > 0 && s.quantity <= s.minLevel).length;
        const outOfStockCount = stock.filter(s => s.quantity === 0).length;

        res.json({
            devices: {
                total: totalDevices,
                available: availableDevices,
                inUse: inUseDevices,
                maintenance: maintDevices
            },
            stock: {
                totalSkus: totalStockItems,
                totalUnits: totalStockUnits,
                lowStock: lowStockCount,
                outOfStock: outOfStockCount,
                totalAlerts: lowStockCount + outOfStockCount
            },
            maintenance: {
                totalTickets: maintenance.length,
                pending: maintenance.filter(m => m.status !== 'Completed').length
            },
            recentTransactions: recentTxns,
            recentActivity: recentActivity
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 2. DEVICES (SERIALIZED ASSETS)
// ============================================================================
app.get('/api/devices', async (req, res) => {
    try {
        const { search, category, status, condition, sort } = req.query;
        let sql = `SELECT * FROM devices WHERE 1=1`;
        const params = [];

        if (search) {
            const term = `%${search.trim()}%`;
            sql += ` AND (name LIKE ? OR id LIKE ? OR serial LIKE ? OR location LIKE ? OR assignedTo LIKE ? OR department LIKE ?)`;
            params.push(term, term, term, term, term, term);
        }
        if (category && category !== 'all') {
            sql += ` AND category = ?`;
            params.push(category);
        }
        if (status && status !== 'all') {
            sql += ` AND status = ?`;
            params.push(status);
        }
        if (condition && condition !== 'all') {
            sql += ` AND condition = ?`;
            params.push(condition);
        }

        switch (sort) {
            case 'name_desc': sql += ` ORDER BY name DESC`; break;
            case 'id_asc': sql += ` ORDER BY id ASC`; break;
            case 'id_desc': sql += ` ORDER BY id DESC`; break;
            case 'date_desc': sql += ` ORDER BY purchaseDate DESC`; break;
            case 'cost_desc': sql += ` ORDER BY cost DESC`; break;
            case 'name_asc':
            default:
                sql += ` ORDER BY name ASC`;
        }

        const rows = await query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/devices/:id', async (req, res) => {
    try {
        const dev = await get(`SELECT * FROM devices WHERE UPPER(id) = UPPER(?)`, [req.params.id]);
        if (!dev) return res.status(404).json({ error: `Device with ID "${req.params.id}" not found.` });
        const maint = await query(`SELECT * FROM maintenance WHERE UPPER(deviceId) = UPPER(?) ORDER BY scheduledDate DESC`, [req.params.id]);
        res.json({ ...dev, maintenance: maint });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/devices', async (req, res) => {
    try {
        const { id, name, category, serial, location, assignedTo = '', department = '', purchaseDate, cost = 0, condition = 'Good', status = 'Available', notes = '' } = req.body;

        if (!id || !name || !category || !serial || !location || !purchaseDate) {
            return res.status(400).json({ error: 'Missing required fields: id, name, category, serial, location, purchaseDate.' });
        }

        if (!(await categoryExists('device', category))) {
            return res.status(400).json({ error: `Category "${category}" does not exist. Pick a device category from the list.` });
        }

        const upperId = id.trim().toUpperCase();
        const cleanSerial = serial.trim();

        // Check unique ID
        const existingId = await get(`SELECT id FROM devices WHERE UPPER(id) = ?`, [upperId]);
        if (existingId) {
            return res.status(409).json({ error: `Asset ID "${upperId}" is already registered. Please use a unique ID.` });
        }

        // Check unique serial
        const existingSerial = await get(`SELECT id, serial FROM devices WHERE UPPER(serial) = UPPER(?)`, [cleanSerial]);
        if (existingSerial) {
            return res.status(409).json({ error: `Serial Number "${cleanSerial}" is already assigned to asset "${existingSerial.id}". Duplicate serial numbers are not allowed.` });
        }

        await run(
            `INSERT INTO devices (id, name, category, serial, location, assignedTo, department, purchaseDate, cost, condition, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [upperId, name.trim(), category.trim(), cleanSerial, location.trim(), assignedTo.trim(), department.trim(), purchaseDate, parseFloat(cost) || 0, condition, status, notes.trim()]
        );

        await logActivity('Device', 'Device Registered', 'New Device Registered', `Registered ${name} (${upperId}) with serial ${cleanSerial} in ${category}.`);

        const created = await get(`SELECT * FROM devices WHERE id = ?`, [upperId]);
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/devices/:id', async (req, res) => {
    try {
        const currentId = req.params.id.trim().toUpperCase();
        const existing = await get(`SELECT * FROM devices WHERE UPPER(id) = ?`, [currentId]);
        if (!existing) return res.status(404).json({ error: `Device "${currentId}" not found.` });

        const { id, name, category, serial, location, assignedTo = '', department = '', purchaseDate, cost = 0, condition = 'Good', status = 'Available', notes = '' } = req.body;

        const newId = (id || currentId).trim().toUpperCase();
        const cleanSerial = (serial || existing.serial).trim();
        if (!category || !(await categoryExists('device', category))) {
            return res.status(400).json({ error: `Category "${category || ''}" does not exist. Pick a device category from the list.` });
        }

        // If ID changed, ensure new ID doesn't collide
        if (newId !== currentId) {
            const idTaken = await get(`SELECT id FROM devices WHERE UPPER(id) = ?`, [newId]);
            if (idTaken) return res.status(409).json({ error: `New Asset ID "${newId}" is already taken.` });
        }

        // Check serial uniqueness if changed
        if (cleanSerial.toUpperCase() !== existing.serial.toUpperCase()) {
            const serialTaken = await get(`SELECT id FROM devices WHERE UPPER(serial) = UPPER(?) AND UPPER(id) != ?`, [cleanSerial, currentId]);
            if (serialTaken) return res.status(409).json({ error: `Serial Number "${cleanSerial}" is already in use by device ${serialTaken.id}.` });
        }

        await run(
            `UPDATE devices SET 
                id = ?, name = ?, category = ?, serial = ?, location = ?, 
                assignedTo = ?, department = ?, purchaseDate = ?, cost = ?, 
                condition = ?, status = ?, notes = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE UPPER(id) = ?`,
            [newId, name.trim(), category.trim(), cleanSerial, location.trim(), assignedTo.trim(), department.trim(), purchaseDate, parseFloat(cost) || 0, condition, status, notes.trim(), currentId]
        );

        // If ID changed, cascade to maintenance
        if (newId !== currentId) {
            await run(`UPDATE maintenance SET deviceId = ? WHERE UPPER(deviceId) = ?`, [newId, currentId]);
        }

        await logActivity('Device', 'Device Updated', 'Device Updated', `Updated device specs for ${name} (${newId}).`);

        const updated = await get(`SELECT * FROM devices WHERE id = ?`, [newId]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/devices/:id/status', async (req, res) => {
    try {
        const id = req.params.id.trim().toUpperCase();
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: 'Status is required.' });

        const existing = await get(`SELECT * FROM devices WHERE UPPER(id) = ?`, [id]);
        if (!existing) return res.status(404).json({ error: `Device "${id}" not found.` });

        await run(`UPDATE devices SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE UPPER(id) = ?`, [status, id]);
        await logActivity('Device', 'Status Changed', 'Device Status Changed', `Status of device ${existing.name} (${id}) changed from "${existing.status}" to "${status}".`);

        const updated = await get(`SELECT * FROM devices WHERE UPPER(id) = ?`, [id]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/devices/:id', async (req, res) => {
    try {
        const id = req.params.id.trim().toUpperCase();
        const existing = await get(`SELECT * FROM devices WHERE UPPER(id) = ?`, [id]);
        if (!existing) return res.status(404).json({ error: `Device "${id}" not found.` });

        await run(`DELETE FROM maintenance WHERE UPPER(deviceId) = ?`, [id]);
        await run(`DELETE FROM devices WHERE UPPER(id) = ?`, [id]);

        await logActivity('Device', 'Device Deleted', 'Device Removed', `Deleted device ${existing.name} (${id}) and cleared its repair logs.`);
        res.json({ success: true, message: `Device ${id} deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 3. STOCK ITEMS & MOVEMENTS
// ============================================================================
app.get('/api/stock', async (req, res) => {
    try {
        const { search, category, level, sort } = req.query;
        let sql = `SELECT * FROM stock WHERE 1=1`;
        const params = [];

        if (search) {
            const term = `%${search.trim()}%`;
            sql += ` AND (name LIKE ? OR id LIKE ? OR location LIKE ? OR supplier LIKE ?)`;
            params.push(term, term, term, term);
        }
        if (category && category !== 'all') {
            sql += ` AND category = ?`;
            params.push(category);
        }
        if (level && level !== 'all') {
            if (level === 'out') sql += ` AND quantity = 0`;
            else if (level === 'low') sql += ` AND quantity > 0 AND quantity <= minLevel`;
            else if (level === 'normal') sql += ` AND quantity > minLevel`;
        }

        switch (sort) {
            case 'name_desc': sql += ` ORDER BY name DESC`; break;
            case 'id_asc': sql += ` ORDER BY id ASC`; break;
            case 'id_desc': sql += ` ORDER BY id DESC`; break;
            case 'qty_asc': sql += ` ORDER BY quantity ASC`; break;
            case 'qty_desc': sql += ` ORDER BY quantity DESC`; break;
            case 'price_desc': sql += ` ORDER BY unitPrice DESC`; break;
            case 'name_asc':
            default:
                sql += ` ORDER BY name ASC`;
        }

        const rows = await query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stock/:id', async (req, res) => {
    try {
        const item = await get(`SELECT * FROM stock WHERE UPPER(id) = UPPER(?)`, [req.params.id]);
        if (!item) return res.status(404).json({ error: `Stock item "${req.params.id}" not found.` });
        const txns = await query(`SELECT * FROM stock_transactions WHERE UPPER(stockId) = UPPER(?) ORDER BY timestamp DESC`, [req.params.id]);
        res.json({ ...item, transactions: txns });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stock', async (req, res) => {
    try {
        const { id, name, category, quantity = 0, minLevel = 5, unit = 'pcs', location, unitPrice = 0, supplier = '', notes = '' } = req.body;

        if (!id || !name || !category || !location) {
            return res.status(400).json({ error: 'Missing required fields: id, name, category, location.' });
        }

        if (!(await categoryExists('stock', category))) {
            return res.status(400).json({ error: `Category "${category}" does not exist. Pick a stock category from the list.` });
        }

        const upperId = id.trim().toUpperCase();
        const existing = await get(`SELECT id FROM stock WHERE UPPER(id) = ?`, [upperId]);
        if (existing) {
            return res.status(409).json({ error: `Stock Item ID "${upperId}" is already cataloged.` });
        }

        const parsedQty = Math.max(0, parseInt(quantity, 10) || 0);
        const parsedMin = Math.max(0, parseInt(minLevel, 10) || 0);
        const parsedPrice = Math.max(0, parseFloat(unitPrice) || 0);

        await run(
            `INSERT INTO stock (id, name, category, quantity, minLevel, unit, location, unitPrice, supplier, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [upperId, name.trim(), category.trim(), parsedQty, parsedMin, unit.trim(), location.trim(), parsedPrice, supplier.trim(), notes.trim()]
        );

        // Record initial inventory receipt if quantity > 0
        if (parsedQty > 0) {
            const txnId = 'TXN-' + Date.now().toString(36).toUpperCase();
            await run(
                `INSERT INTO stock_transactions (id, stockId, stockName, type, quantity, previousQty, newQty, reference, performedBy, timestamp, notes)
                 VALUES (?, ?, ?, 'Stock-In', ?, 0, ?, 'Initial Inventory Opening Balance', 'Admin', ?, 'System opening balance')`,
                [txnId, upperId, name.trim(), parsedQty, parsedQty, new Date().toISOString()]
            );
        }

        await logActivity('Stock', 'Stock Item Created', 'Stock Cataloged', `Cataloged new stock item ${name} (${upperId}) with initial quantity ${parsedQty} ${unit}.`);

        const created = await get(`SELECT * FROM stock WHERE id = ?`, [upperId]);
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/stock/:id', async (req, res) => {
    try {
        const currentId = req.params.id.trim().toUpperCase();
        const existing = await get(`SELECT * FROM stock WHERE UPPER(id) = ?`, [currentId]);
        if (!existing) return res.status(404).json({ error: `Stock item "${currentId}" not found.` });

        const { id, name, category, minLevel = 5, unit = 'pcs', location, unitPrice = 0, supplier = '', notes = '' } = req.body;
        const newId = (id || currentId).trim().toUpperCase();
        if (!category || !(await categoryExists('stock', category))) {
            return res.status(400).json({ error: `Category "${category || ''}" does not exist. Pick a stock category from the list.` });
        }

        if (newId !== currentId) {
            const idTaken = await get(`SELECT id FROM stock WHERE UPPER(id) = ?`, [newId]);
            if (idTaken) return res.status(409).json({ error: `Stock Item ID "${newId}" already exists.` });
        }

        await run(
            `UPDATE stock SET 
                id = ?, name = ?, category = ?, minLevel = ?, unit = ?, 
                location = ?, unitPrice = ?, supplier = ?, notes = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE UPPER(id) = ?`,
            [newId, name.trim(), category.trim(), Math.max(0, parseInt(minLevel, 10) || 0), unit.trim(), location.trim(), Math.max(0, parseFloat(unitPrice) || 0), supplier.trim(), notes.trim(), currentId]
        );

        if (newId !== currentId) {
            await run(`UPDATE stock_transactions SET stockId = ?, stockName = ? WHERE UPPER(stockId) = ?`, [newId, name.trim(), currentId]);
        }

        await logActivity('Stock', 'Stock Item Updated', 'Stock Catalog Updated', `Updated stock catalog parameters for ${name} (${newId}).`);

        const updated = await get(`SELECT * FROM stock WHERE id = ?`, [newId]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/stock/:id', async (req, res) => {
    try {
        const id = req.params.id.trim().toUpperCase();
        const existing = await get(`SELECT * FROM stock WHERE UPPER(id) = ?`, [id]);
        if (!existing) return res.status(404).json({ error: `Stock item "${id}" not found.` });

        await run(`DELETE FROM stock_transactions WHERE UPPER(stockId) = ?`, [id]);
        await run(`DELETE FROM stock WHERE UPPER(id) = ?`, [id]);

        await logActivity('Stock', 'Stock Item Deleted', 'Stock Item Removed', `Deleted stock consumable ${existing.name} (${id}) and movement history.`);
        res.json({ success: true, message: `Stock item ${id} deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Perform Stock Movement (Stock-In, Stock-Out, Stock Return)
app.post('/api/stock/movement', async (req, res) => {
    try {
        const { stockId, movementType, quantity, reference = '', notes = '' } = req.body;

        if (!stockId || !movementType || !quantity) {
            return res.status(400).json({ error: 'stockId, movementType, and quantity are required.' });
        }

        const validTypes = ['Stock-In', 'Stock-Out', 'Stock Return'];
        if (!validTypes.includes(movementType)) {
            return res.status(400).json({ error: `Invalid movementType: "${movementType}". Must be one of: ${validTypes.join(', ')}` });
        }

        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty <= 0) {
            return res.status(400).json({ error: 'Movement quantity must be a positive integer greater than zero.' });
        }

        const upperId = stockId.trim().toUpperCase();
        const item = await get(`SELECT * FROM stock WHERE UPPER(id) = ?`, [upperId]);
        if (!item) {
            return res.status(404).json({ error: `Stock item "${upperId}" does not exist.` });
        }

        const prevQty = item.quantity;
        let newQty = prevQty;

        if (movementType === 'Stock-In' || movementType === 'Stock Return') {
            newQty = prevQty + qty;
        } else if (movementType === 'Stock-Out') {
            if (prevQty < qty) {
                return res.status(400).json({
                    error: `Cannot issue ${qty} ${item.unit}. Only ${prevQty} ${item.unit} are currently in stock.`
                });
            }
            newQty = prevQty - qty;
        }

        // Generate Transaction ID
        const txnCount = await get(`SELECT COUNT(*) as count FROM stock_transactions`);
        const txnId = 'TXN-' + String((txnCount ? txnCount.count : 0) + 1).padStart(3, '0');
        const timestamp = new Date().toISOString();

        // Update Stock Quantity
        await run(`UPDATE stock SET quantity = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [newQty, upperId]);

        // Record Transaction
        await run(
            `INSERT INTO stock_transactions (id, stockId, stockName, type, quantity, previousQty, newQty, reference, performedBy, timestamp, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Admin', ?, ?)`,
            [txnId, upperId, item.name, movementType, qty, prevQty, newQty, reference.trim() || 'Standard Stock Movement', timestamp, notes.trim()]
        );

        await logActivity(
            'Stock',
            movementType,
            `Stock Movement: ${movementType}`,
            `${movementType} of ${qty} ${item.unit} for ${item.name} (${upperId}). Balance: ${newQty} ${item.unit}. Ref: ${reference}`
        );

        const updatedItem = await get(`SELECT * FROM stock WHERE id = ?`, [upperId]);
        const txn = await get(`SELECT * FROM stock_transactions WHERE id = ?`, [txnId]);

        res.json({
            success: true,
            item: updatedItem,
            transaction: txn
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stock/transactions/all', async (req, res) => {
    try {
        const { search, type } = req.query;
        let sql = `SELECT * FROM stock_transactions WHERE 1=1`;
        const params = [];

        if (search) {
            const term = `%${search.trim()}%`;
            sql += ` AND (id LIKE ? OR stockId LIKE ? OR stockName LIKE ? OR reference LIKE ?)`;
            params.push(term, term, term, term);
        }
        if (type && type !== 'all') {
            sql += ` AND type = ?`;
            params.push(type);
        }

        sql += ` ORDER BY timestamp DESC`;
        const rows = await query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 4. MAINTENANCE WORK ORDERS
// ============================================================================
app.get('/api/maintenance', async (req, res) => {
    try {
        const { search, status, type, deviceId } = req.query;
        let sql = `SELECT m.*, d.name as deviceName, d.location as deviceLocation FROM maintenance m LEFT JOIN devices d ON UPPER(m.deviceId) = UPPER(d.id) WHERE 1=1`;
        const params = [];

        if (deviceId) {
            sql += ` AND UPPER(m.deviceId) = UPPER(?)`;
            params.push(deviceId.trim());
        }
        if (search) {
            const term = `%${search.trim()}%`;
            sql += ` AND (m.id LIKE ? OR m.title LIKE ? OR m.deviceId LIKE ? OR m.technician LIKE ?)`;
            params.push(term, term, term, term);
        }
        if (status && status !== 'all') {
            sql += ` AND m.status = ?`;
            params.push(status);
        }
        if (type && type !== 'all') {
            sql += ` AND m.type = ?`;
            params.push(type);
        }

        sql += ` ORDER BY m.scheduledDate DESC`;
        const rows = await query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/maintenance', async (req, res) => {
    try {
        const { deviceId, title, type = 'Repair', scheduledDate, completedDate = '', status = 'Scheduled', cost = 0, technician = '', notes = '' } = req.body;

        if (!deviceId || !title || !scheduledDate) {
            return res.status(400).json({ error: 'deviceId, title, and scheduledDate are required.' });
        }

        const upperDevId = deviceId.trim().toUpperCase();
        const dev = await get(`SELECT * FROM devices WHERE UPPER(id) = ?`, [upperDevId]);
        if (!dev) return res.status(404).json({ error: `Device "${upperDevId}" does not exist.` });

        const countRow = await get(`SELECT COUNT(*) as count FROM maintenance`);
        const id = 'MNT-' + String((countRow ? countRow.count : 0) + 1).padStart(3, '0');

        await run(
            `INSERT INTO maintenance (id, deviceId, title, type, scheduledDate, completedDate, status, cost, technician, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, upperDevId, title.trim(), type, scheduledDate, completedDate, status, parseFloat(cost) || 0, technician.trim(), notes.trim()]
        );

        // If status is In Progress or Scheduled and device is Available, optionally transition to Under Maintenance
        if (status === 'In Progress') {
            await run(`UPDATE devices SET status = 'Under Maintenance' WHERE id = ?`, [upperDevId]);
        } else if (status === 'Completed' && dev.status === 'Under Maintenance') {
            await run(`UPDATE devices SET status = 'Available' WHERE id = ?`, [upperDevId]);
        }

        await logActivity('Maintenance', 'Ticket Created', 'Maintenance Ticket Created', `Created repair ticket ${id} (${title}) for device ${upperDevId}.`);

        const created = await get(`SELECT * FROM maintenance WHERE id = ?`, [id]);
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/maintenance/:id', async (req, res) => {
    try {
        const currentId = req.params.id.trim();
        const existing = await get(`SELECT * FROM maintenance WHERE id = ?`, [currentId]);
        if (!existing) return res.status(404).json({ error: `Maintenance ticket "${currentId}" not found.` });

        const { title, type = 'Repair', scheduledDate, completedDate = '', status = 'Scheduled', cost = 0, technician = '', notes = '' } = req.body;

        await run(
            `UPDATE maintenance SET 
                title = ?, type = ?, scheduledDate = ?, completedDate = ?, 
                status = ?, cost = ?, technician = ?, notes = ?
             WHERE id = ?`,
            [title.trim(), type, scheduledDate, completedDate, status, parseFloat(cost) || 0, technician.trim(), notes.trim(), currentId]
        );

        // If status marked Completed, check device status
        if (status === 'Completed') {
            const dev = await get(`SELECT * FROM devices WHERE UPPER(id) = UPPER(?)`, [existing.deviceId]);
            if (dev && dev.status === 'Under Maintenance') {
                await run(`UPDATE devices SET status = 'Available' WHERE UPPER(id) = UPPER(?)`, [existing.deviceId]);
            }
        }

        await logActivity('Maintenance', 'Ticket Updated', 'Maintenance Ticket Updated', `Updated repair ticket ${currentId} for device ${existing.deviceId}.`);

        const updated = await get(`SELECT * FROM maintenance WHERE id = ?`, [currentId]);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/maintenance/:id', async (req, res) => {
    try {
        const id = req.params.id.trim();
        const existing = await get(`SELECT * FROM maintenance WHERE id = ?`, [id]);
        if (!existing) return res.status(404).json({ error: `Maintenance record "${id}" not found.` });

        await run(`DELETE FROM maintenance WHERE id = ?`, [id]);
        await logActivity('Maintenance', 'Ticket Deleted', 'Maintenance Ticket Removed', `Removed ticket ${id} for device ${existing.deviceId}.`);
        res.json({ success: true, message: `Maintenance record ${id} deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 5. CATEGORIES
// ============================================================================
app.get('/api/categories', async (req, res) => {
    try {
        const rows = await query(`SELECT * FROM categories ORDER BY type ASC, name ASC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { type, name, prefix, desc = '' } = req.body;
        if (!type || !name || !prefix) return res.status(400).json({ error: 'type, name, and prefix are required.' });
        if (!['device', 'stock'].includes(type)) {
            return res.status(400).json({ error: 'type must be either "device" or "stock".' });
        }

        const upperPrefix = String(prefix).trim().toUpperCase();
        const cleanName = String(name).trim();
        if (!cleanName) return res.status(400).json({ error: 'Category name is required.' });
        if (!/^[A-Z0-9]{2,6}$/.test(upperPrefix)) {
            return res.status(400).json({ error: 'Prefix must contain 2-6 letters or numbers.' });
        }

        const typeCode = type === 'device' ? 'DEV' : 'STK';
        const existingCategories = await query(`SELECT id FROM categories WHERE type = ?`, [type]);
        const nextNumber = existingCategories.reduce((maxNumber, category) => {
            const match = category.id.match(new RegExp(`^CAT-${typeCode}-(\\d+)$`));
            return match ? Math.max(maxNumber, Number(match[1])) : maxNumber;
        }, 0) + 1;
        const id = `CAT-${typeCode}-${nextNumber}`;

        await run(
            `INSERT INTO categories (id, type, name, prefix, desc) VALUES (?, ?, ?, ?, ?)`,
            [id, type, cleanName, upperPrefix, desc.trim()]
        );

        await logActivity('System', 'Category Added', 'Category Added', `Added ${type} category "${cleanName}" (${upperPrefix}).`);
        const created = await get(`SELECT * FROM categories WHERE id = ?`, [id]);
        res.status(201).json(created);
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Category prefix or name already exists in this module.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await get(`SELECT * FROM categories WHERE id = ?`, [id]);
        if (!existing) return res.status(404).json({ error: `Category "${id}" not found.` });

        const cleanName = String(req.body.name || '').trim();
        const upperPrefix = String(req.body.prefix || '').trim().toUpperCase();
        const desc = String(req.body.desc || '').trim();

        if (!cleanName || !upperPrefix) {
            return res.status(400).json({ error: 'Category name and prefix are required.' });
        }
        if (!/^[A-Z0-9]{2,6}$/.test(upperPrefix)) {
            return res.status(400).json({ error: 'Prefix must contain 2-6 letters or numbers.' });
        }

        // Prevent duplicate names/prefixes while editing.
        const duplicate = await get(
            `SELECT id FROM categories WHERE type = ? AND (name = ? OR prefix = ?) AND id != ? LIMIT 1`,
            [existing.type, cleanName, upperPrefix, id]
        );
        if (duplicate) {
            return res.status(409).json({ error: 'A category with this name or prefix already exists in this module.' });
        }

        await run(
            `UPDATE categories SET name = ?, prefix = ?, desc = ? WHERE id = ?`,
            [cleanName, upperPrefix, desc, id]
        );

        // Category names are stored on inventory records. Keep those references valid
        // when a category is renamed instead of leaving orphaned/stale category values.
        if (existing.name !== cleanName) {
            if (existing.type === 'device') {
                await run(`UPDATE devices SET category = ?, updatedAt = CURRENT_TIMESTAMP WHERE category = ?`, [cleanName, existing.name]);
            } else {
                await run(`UPDATE stock SET category = ?, updatedAt = CURRENT_TIMESTAMP WHERE category = ?`, [cleanName, existing.name]);
            }
        }

        await logActivity(
            'System',
            'Category Updated',
            'Category Updated',
            `Updated ${existing.type} category "${existing.name}" to "${cleanName}" (${upperPrefix}).`
        );

        const updated = await get(`SELECT * FROM categories WHERE id = ?`, [id]);
        res.json(updated);
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'A category with this name or prefix already exists in this module.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const cat = await get(`SELECT * FROM categories WHERE id = ?`, [id]);
        if (!cat) return res.status(404).json({ error: `Category "${id}" not found.` });

        // Check if any devices or stock items are assigned to this category
        if (cat.type === 'device') {
            const assigned = await get(`SELECT id FROM devices WHERE category = ? LIMIT 1`, [cat.name]);
            if (assigned) return res.status(400).json({ error: `Cannot delete category "${cat.name}": devices are currently registered under it.` });
        } else {
            const assigned = await get(`SELECT id FROM stock WHERE category = ? LIMIT 1`, [cat.name]);
            if (assigned) return res.status(400).json({ error: `Cannot delete category "${cat.name}": stock items are currently cataloged under it.` });
        }

        await run(`DELETE FROM categories WHERE id = ?`, [id]);
        await logActivity('System', 'Category Deleted', 'Category Deleted', `Deleted category "${cat.name}".`);
        res.json({ success: true, message: `Category deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 6. QR LOOKUP & VERIFICATION ENDPOINT
// ============================================================================
app.get('/api/qr/lookup/:code', async (req, res) => {
    try {
        const code = req.params.code.trim();
        // 1. Try matching Device ID
        let dev = await get(`SELECT * FROM devices WHERE UPPER(id) = UPPER(?)`, [code]);
        if (!dev) {
            // 2. Try matching Device Serial
            dev = await get(`SELECT * FROM devices WHERE UPPER(serial) = UPPER(?)`, [code]);
        }
        if (dev) {
            const maint = await query(`SELECT * FROM maintenance WHERE UPPER(deviceId) = UPPER(?) ORDER BY scheduledDate DESC`, [dev.id]);
            await logActivity('QR Scanned', 'Device Scanned', 'QR Code Scanned', `Scanned device ${dev.id} (${dev.name}) via QR lookup.`);
            return res.json({
                found: true,
                entityType: 'Device',
                data: { ...dev, maintenance: maint }
            });
        }

        // 3. Try matching Stock Item ID
        const stock = await get(`SELECT * FROM stock WHERE UPPER(id) = UPPER(?)`, [code]);
        if (stock) {
            const txns = await query(`SELECT * FROM stock_transactions WHERE UPPER(stockId) = UPPER(?) ORDER BY timestamp DESC LIMIT 10`, [stock.id]);
            await logActivity('QR Scanned', 'Stock Scanned', 'QR Code Scanned', `Scanned stock item ${stock.id} (${stock.name}) via QR lookup.`);
            return res.json({
                found: true,
                entityType: 'Stock',
                data: { ...stock, transactions: txns }
            });
        }

        // 4. Not found
        res.status(404).json({
            found: false,
            code: code,
            error: `Identifier "${code}" not found in system.`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 7. ACTIVITY LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
    try {
        const { search, category, type } = req.query;
        let sql = `SELECT * FROM activity_logs WHERE 1=1`;
        const params = [];

        if (search) {
            const term = `%${search.trim()}%`;
            sql += ` AND (title LIKE ? OR details LIKE ? OR id LIKE ?)`;
            params.push(term, term, term);
        }
        if (category && category !== 'all') {
            sql += ` AND category = ?`;
            params.push(category);
        }
        if (type && type !== 'all') {
            sql += ` AND type = ?`;
            params.push(type);
        }

        sql += ` ORDER BY timestamp DESC LIMIT 200`;
        const rows = await query(sql, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        await run(`DELETE FROM activity_logs`);
        res.json({ success: true, message: 'Activity logs cleared.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 8. SETTINGS
// ============================================================================
app.get('/api/settings', async (req, res) => {
    try {
        const s = await get(`SELECT * FROM settings WHERE id = 1`);
        res.json(s || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings', async (req, res) => {
    try {
        const { orgName, currency, defaultLowStock, soundEnabled, autoOpenModal, scanCooldown, theme } = req.body;
        await run(
            `UPDATE settings SET 
                orgName = COALESCE(?, orgName),
                currency = COALESCE(?, currency),
                defaultLowStock = COALESCE(?, defaultLowStock),
                soundEnabled = COALESCE(?, soundEnabled),
                autoOpenModal = COALESCE(?, autoOpenModal),
                scanCooldown = COALESCE(?, scanCooldown),
                theme = COALESCE(?, theme)
             WHERE id = 1`,
            [orgName, currency, defaultLowStock, soundEnabled !== undefined ? (soundEnabled ? 1 : 0) : null, autoOpenModal !== undefined ? (autoOpenModal ? 1 : 0) : null, scanCooldown, theme]
        );
        const updated = await get(`SELECT * FROM settings WHERE id = 1`);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 9. BACKUP / RESTORE / RESET
// ============================================================================
app.get('/api/backup/export', async (req, res) => {
    try {
        const settings = await get(`SELECT * FROM settings WHERE id = 1`);
        const categories = await query(`SELECT * FROM categories`);
        const devices = await query(`SELECT * FROM devices`);
        const stock = await query(`SELECT * FROM stock`);
        const txns = await query(`SELECT * FROM stock_transactions`);
        const maint = await query(`SELECT * FROM maintenance`);
        const logs = await query(`SELECT * FROM activity_logs`);

        res.json({
            version: '2.0-sqlite',
            exportedAt: new Date().toISOString(),
            settings,
            categories,
            devices,
            stock,
            stockTransactions: txns,
            maintenance: maint,
            logs
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/backup/restore', async (req, res) => {
    try {
        const data = req.body;
        if (!data || !data.devices || !data.stock) {
            return res.status(400).json({ error: 'Invalid backup format. Must contain devices and stock arrays.' });
        }

        // Wipe and recreate
        await run(`DELETE FROM activity_logs`);
        await run(`DELETE FROM maintenance`);
        await run(`DELETE FROM stock_transactions`);
        await run(`DELETE FROM stock`);
        await run(`DELETE FROM devices`);
        await run(`DELETE FROM categories`);

        if (data.categories && Array.isArray(data.categories)) {
            for (const c of data.categories) {
                await run(`INSERT OR REPLACE INTO categories (id, type, name, prefix, desc) VALUES (?, ?, ?, ?, ?)`, [c.id, c.type, c.name, c.prefix, c.desc || '']);
            }
        }
        if (data.devices && Array.isArray(data.devices)) {
            for (const d of data.devices) {
                await run(`INSERT OR REPLACE INTO devices (id, name, category, serial, location, assignedTo, department, purchaseDate, cost, condition, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [d.id, d.name, d.category, d.serial, d.location, d.assignedTo || '', d.department || '', d.purchaseDate, d.cost || 0, d.condition || 'Good', d.status || 'Available', d.notes || '']);
            }
        }
        if (data.stock && Array.isArray(data.stock)) {
            for (const s of data.stock) {
                await run(`INSERT OR REPLACE INTO stock (id, name, category, quantity, minLevel, unit, location, unitPrice, supplier, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [s.id, s.name, s.category, s.quantity || 0, s.minLevel || 5, s.unit || 'pcs', s.location, s.unitPrice || 0, s.supplier || '', s.notes || '']);
            }
        }
        if (data.stockTransactions && Array.isArray(data.stockTransactions)) {
            for (const t of data.stockTransactions) {
                await run(`INSERT OR REPLACE INTO stock_transactions (id, stockId, stockName, type, quantity, previousQty, newQty, reference, performedBy, timestamp, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [t.id, t.stockId, t.stockName, t.type, t.quantity, t.previousQty, t.newQty, t.reference || '', t.performedBy || 'Admin', t.timestamp, t.notes || '']);
            }
        }
        if (data.maintenance && Array.isArray(data.maintenance)) {
            for (const m of data.maintenance) {
                await run(`INSERT OR REPLACE INTO maintenance (id, deviceId, title, type, scheduledDate, completedDate, status, cost, technician, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [m.id, m.deviceId, m.title, m.type || 'Repair', m.scheduledDate, m.completedDate || '', m.status || 'Scheduled', m.cost || 0, m.technician || '', m.notes || '']);
            }
        }
        if (data.settings) {
            await run(`UPDATE settings SET orgName = ?, currency = ?, defaultLowStock = ?, soundEnabled = ?, autoOpenModal = ?, scanCooldown = ?, theme = ? WHERE id = 1`,
                [data.settings.orgName, data.settings.currency, data.settings.defaultLowStock, data.settings.soundEnabled, data.settings.autoOpenModal, data.settings.scanCooldown, data.settings.theme]);
        }

        await logActivity('System', 'Database Restored', 'Database Restored', `Restored database backup containing ${data.devices.length} devices and ${data.stock.length} stock items.`);
        res.json({ success: true, message: 'Database restored successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SPA Fallback: Send index.html for any other frontend route
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
});

// Start Server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`TrackQR Inventory & Asset Tracker Server Running!`);
        console.log(`URL: http://localhost:${PORT}`);
        console.log(`Database: SQLite persistent file`);
        console.log(`====================================================`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
