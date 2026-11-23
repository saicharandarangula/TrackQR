/**
 * TrackQR – Full-Stack QR-Based Inventory & Stock Tracker
 * Complete Frontend Controller & Database API Integration Layer
 */

// =============================================================================
// 1. STORAGE SERVICE (REST API DATA LAYER WITH PERSISTENT SQLITE BACKEND)
// =============================================================================
const StorageService = (function () {
    // API base can be configured for local development, deployed hosting, or a mobile wrapper.
    // Examples:
    //   window.TRACKQR_API_BASE = "https://your-backend.example.com/api";
    //   <meta name="trackqr-api-base" content="https://your-backend.example.com/api">
    const configuredApiBase =
        window.TRACKQR_API_BASE ||
        document.querySelector('meta[name="trackqr-api-base"]')?.content ||
        "";
    const isLocalFrontend = ["5500", "5501", "3000", "5173"].includes(window.location.port);
    const API_BASE = (configuredApiBase || (isLocalFrontend ? "http://localhost:5000/api" : "/api")).replace(/\/$/, "");

    // In-memory cache for ultra-fast synchronous rendering & offline fallback
    let cache = {
        settings: {
            orgName: "GlobalTech Industries",
            currency: "$",
            defaultLowStock: 10,
            soundEnabled: 1,
            autoOpenModal: 0,
            scanCooldown: 2500,
            theme: "light"
        },
        devices: [],
        stock: [],
        transactions: [],
        maintenance: [],
        categories: [],
        logs: [],
        stats: null
    };

    // Generic JSON Fetch Helper
    async function apiRequest(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, options);
            const text = await res.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (jsonErr) {
                throw new Error(`Server returned non-JSON response (${res.status}). Make sure the backend server is running on http://localhost:5000`);
            }
            if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}: Failed request to ${endpoint}`);
            }
            return data;
        } catch (err) {
            console.error(`API Error [${method} ${endpoint}]:`, err.message);
            throw err;
        }
    }

    // Sync Cache from Backend
    async function loadAllFromBackend() {
        try {
            const [settings, devices, stock, transactions, maintenance, categories, logs, stats] = await Promise.all([
                apiRequest('/settings').catch(() => cache.settings),
                apiRequest('/devices').catch(() => cache.devices),
                apiRequest('/stock').catch(() => cache.stock),
                apiRequest('/stock/transactions/all').catch(() => cache.transactions),
                apiRequest('/maintenance').catch(() => cache.maintenance),
                apiRequest('/categories').catch(() => cache.categories),
                apiRequest('/logs').catch(() => cache.logs),
                apiRequest('/dashboard/stats').catch(() => null)
            ]);

            cache.settings = settings || cache.settings;
            cache.devices = devices || [];
            cache.stock = stock || [];
            cache.transactions = transactions || [];
            cache.maintenance = maintenance || [];
            cache.categories = categories || [];
            cache.logs = logs || [];
            cache.stats = stats;

            return true;
        } catch (e) {
            console.warn("Could not sync cache with backend:", e.message);
            return false;
        }
    }

    return {
        loadAllFromBackend,

        // Settings
        getSettings: function () {
            return Object.assign({}, cache.settings);
        },
        saveSettings: async function (newSettings) {
            const updated = await apiRequest('/settings', 'PUT', newSettings);
            cache.settings = Object.assign({}, cache.settings, updated);
            return cache.settings;
        },

        // Devices
        getDevices: function () {
            return [...cache.devices];
        },
        getDeviceById: function (id) {
            if (!id) return null;
            const searchId = id.trim().toUpperCase();
            return cache.devices.find(d => d.id.toUpperCase() === searchId) || null;
        },
        saveDevice: async function (deviceData, isEdit = false, originalId = '') {
            let res;
            if (isEdit && originalId) {
                res = await apiRequest(`/devices/${encodeURIComponent(originalId)}`, 'PUT', deviceData);
                const idx = cache.devices.findIndex(d => d.id.toUpperCase() === originalId.toUpperCase());
                if (idx >= 0) cache.devices[idx] = res;
                else cache.devices.unshift(res);
            } else {
                res = await apiRequest('/devices', 'POST', deviceData);
                cache.devices.unshift(res);
            }
            await this.refreshLogs();
            return res;
        },
        updateDeviceStatus: async function (id, status) {
            const updated = await apiRequest(`/devices/${encodeURIComponent(id)}/status`, 'PATCH', { status });
            const idx = cache.devices.findIndex(d => d.id.toUpperCase() === id.toUpperCase());
            if (idx >= 0) cache.devices[idx] = updated;
            await this.refreshLogs();
            return updated;
        },
        deleteDevice: async function (id) {
            await apiRequest(`/devices/${encodeURIComponent(id)}`, 'DELETE');
            cache.devices = cache.devices.filter(d => d.id.toUpperCase() !== id.toUpperCase());
            cache.maintenance = cache.maintenance.filter(m => m.deviceId.toUpperCase() !== id.toUpperCase());
            await this.refreshLogs();
            return true;
        },

        // Stock
        getStock: function () {
            return [...cache.stock];
        },
        getStockById: function (id) {
            if (!id) return null;
            const searchId = id.trim().toUpperCase();
            return cache.stock.find(s => s.id.toUpperCase() === searchId) || null;
        },
        saveStock: async function (stockData, isEdit = false, originalId = '') {
            let res;
            if (isEdit && originalId) {
                res = await apiRequest(`/stock/${encodeURIComponent(originalId)}`, 'PUT', stockData);
                const idx = cache.stock.findIndex(s => s.id.toUpperCase() === originalId.toUpperCase());
                if (idx >= 0) cache.stock[idx] = res;
                else cache.stock.unshift(res);
            } else {
                res = await apiRequest('/stock', 'POST', stockData);
                cache.stock.unshift(res);
            }
            await this.refreshTransactions();
            await this.refreshLogs();
            return res;
        },
        deleteStock: async function (id) {
            await apiRequest(`/stock/${encodeURIComponent(id)}`, 'DELETE');
            cache.stock = cache.stock.filter(s => s.id.toUpperCase() !== id.toUpperCase());
            cache.transactions = cache.transactions.filter(t => t.stockId.toUpperCase() !== id.toUpperCase());
            await this.refreshLogs();
            return true;
        },
        performStockMovement: async function (stockId, movementType, quantity, reference = '', notes = '') {
            const res = await apiRequest('/stock/movement', 'POST', {
                stockId,
                movementType,
                quantity,
                reference,
                notes
            });
            // Update stock item in cache
            if (res.item) {
                const idx = cache.stock.findIndex(s => s.id.toUpperCase() === res.item.id.toUpperCase());
                if (idx >= 0) cache.stock[idx] = res.item;
            }
            if (res.transaction) {
                cache.transactions.unshift(res.transaction);
            }
            await this.refreshLogs();
            return res;
        },

        // Transactions
        getStockTransactions: function () {
            return [...cache.transactions];
        },
        refreshTransactions: async function () {
            try {
                cache.transactions = await apiRequest('/stock/transactions/all');
            } catch (e) {}
        },

        // Maintenance
        getMaintenance: function () {
            return [...cache.maintenance];
        },
        getMaintenanceByDeviceId: function (deviceId) {
            if (!deviceId) return [];
            return cache.maintenance.filter(m => m.deviceId.toUpperCase() === deviceId.toUpperCase());
        },
        saveMaintenance: async function (ticketData, isEdit = false, id = '') {
            let res;
            if (isEdit && id) {
                res = await apiRequest(`/maintenance/${encodeURIComponent(id)}`, 'PUT', ticketData);
                const idx = cache.maintenance.findIndex(m => m.id === id);
                if (idx >= 0) cache.maintenance[idx] = res;
            } else {
                res = await apiRequest('/maintenance', 'POST', ticketData);
                cache.maintenance.unshift(res);
            }
            // Sync any device status changes
            const dev = cache.devices.find(d => d.id.toUpperCase() === res.deviceId.toUpperCase());
            if (dev && res.status === 'In Progress') dev.status = 'Under Maintenance';
            else if (dev && res.status === 'Completed' && dev.status === 'Under Maintenance') dev.status = 'Available';

            await this.refreshLogs();
            return res;
        },
        deleteMaintenance: async function (id) {
            await apiRequest(`/maintenance/${encodeURIComponent(id)}`, 'DELETE');
            cache.maintenance = cache.maintenance.filter(m => m.id !== id);
            await this.refreshLogs();
            return true;
        },

        // Categories
        getCategories: function () {
            return [...cache.categories];
        },
        getDeviceCategories: function () {
            return cache.categories.filter(c => c.type === 'device');
        },
        getStockCategories: function () {
            return cache.categories.filter(c => c.type === 'stock');
        },
        saveCategory: async function (catData, isEdit = false, id = '') {
            let res;
            if (isEdit && id) {
                res = await apiRequest(`/categories/${encodeURIComponent(id)}`, 'PUT', catData);
                const idx = cache.categories.findIndex(c => c.id === id);
                if (idx >= 0) cache.categories[idx] = res;
            } else {
                res = await apiRequest('/categories', 'POST', catData);
                cache.categories.push(res);
            }
            // A rename also rewrites category names on devices/stock in the database,
            // so reload everything to keep counts, filters and dropdowns in sync.
            await loadAllFromBackend();
            return res;
        },
        deleteCategory: async function (id) {
            await apiRequest(`/categories/${encodeURIComponent(id)}`, 'DELETE');
            cache.categories = cache.categories.filter(c => c.id !== id);
            await loadAllFromBackend();
            return true;
        },

        // QR Lookup Endpoint
        lookupQrCode: async function (code) {
            return await apiRequest(`/qr/lookup/${encodeURIComponent(code)}`);
        },

        // Activity Logs
        getLogs: function () {
            return [...cache.logs];
        },
        refreshLogs: async function () {
            try {
                cache.logs = await apiRequest('/logs');
            } catch (e) {}
        },
        clearLogs: async function () {
            await apiRequest('/logs', 'DELETE');
            cache.logs = [];
            return true;
        },

        // Backup & Restore
        exportDatabaseJSON: async function () {
            const data = await apiRequest('/backup/export');
            return JSON.stringify(data, null, 2);
        },
        importDatabaseJSON: async function (jsonString) {
            const data = JSON.parse(jsonString);
            await apiRequest('/backup/restore', 'POST', data);
            await loadAllFromBackend();
            return true;
        }
    };
})();


// =============================================================================
// 2. UI & NOTIFICATION SYSTEM
// =============================================================================
const UIManager = (function () {
    function playBeepSound() {
        const settings = StorageService.getSettings();
        if (!settings.soundEnabled) return;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);

            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + 0.26);
        } catch (e) {
            console.warn("Audio chime prevented:", e);
        }
    }

    function showToast(message, type = "info", title = "") {
        const container = document.getElementById("toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;

        const iconMap = {
            success: "#icon-check",
            error: "#icon-alert",
            warning: "#icon-alert",
            info: "#icon-dashboard"
        };
        const iconHref = iconMap[type] || "#icon-dashboard";
        const titleText = title || (type.charAt(0).toUpperCase() + type.slice(1));

        toast.innerHTML = `
            <svg class="icon-inline toast-icon"><use href="${iconHref}"/></svg>
            <div class="toast-content">
                <div class="toast-title">${escapeHtml(titleText)}</div>
                <div class="toast-message">${escapeHtml(message)}</div>
            </div>
            <button class="toast-close-btn" aria-label="Dismiss">&times;</button>
        `;

        toast.querySelector(".toast-close-btn").addEventListener("click", () => removeToast(toast));
        container.appendChild(toast);

        setTimeout(() => removeToast(toast), 4000);
    }

    function removeToast(toast) {
        if (!toast || toast.classList.contains("removing")) return;
        toast.classList.add("removing");
        setTimeout(() => {
            if (toast.parentElement) toast.parentElement.removeChild(toast);
        }, 220);
    }

    let confirmCallback = null;

    function confirmAction(message, onConfirm, title = "Confirm Action") {
        const modal = document.getElementById("confirmModal");
        document.getElementById("confirmModalTitle").textContent = title;
        document.getElementById("confirmModalMessage").textContent = message;
        confirmCallback = onConfirm;
        modal.classList.add("active");
    }

    function closeConfirmModal() {
        document.getElementById("confirmModal").classList.remove("active");
        confirmCallback = null;
    }

    document.getElementById("confirmModalOkBtn")?.addEventListener("click", function () {
        if (typeof confirmCallback === "function") confirmCallback();
        closeConfirmModal();
    });

    document.getElementById("confirmModalCancelBtn")?.addEventListener("click", closeConfirmModal);
    document.getElementById("closeConfirmModalBtn")?.addEventListener("click", closeConfirmModal);

    return {
        playBeepSound,
        showToast,
        confirmAction,
        closeConfirmModal
    };
})();

// Helper Functions
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatCurrency(amount) {
    const s = StorageService.getSettings();
    const curr = s.currency || "$";
    const num = parseFloat(amount) || 0;
    return `${curr}${num.toFixed(2)}`;
}

function formatDate(dateStr) {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(isoStr) {
    if (!isoStr) return "N/A";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}


// =============================================================================
// 3. QR CODE GENERATION & PRINT CONTROLLER
// =============================================================================
const QrController = (function () {
    function renderQrCode(container, text, size = 180) {
        if (!container) return;
        container.innerHTML = "";

        if (typeof QRCode === "undefined") {
            container.innerHTML = `<p style="color: red; font-size: 11px;">QRCode library not loaded</p>`;
            return;
        }

        try {
            new QRCode(container, {
                text: text,
                width: size,
                height: size,
                colorDark: "#0f172a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch (e) {
            console.error("QR Generation error:", e);
            container.innerHTML = `<p style="color: red; font-size: 11px;">QR Render Failed</p>`;
        }
    }

    function downloadQrPng(id, name, type = 'Device') {
        const settings = StorageService.getSettings();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = 600;
        canvas.height = 760;

        // Background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Border
        ctx.lineWidth = 14;
        ctx.strokeStyle = "#0d9488";
        ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);

        // Header Banner
        ctx.fillStyle = "#0d9488";
        ctx.fillRect(14, 14, canvas.width - 28, 90);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 26px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(settings.orgName.toUpperCase(), canvas.width / 2, 54);

        ctx.font = "bold 16px -apple-system, sans-serif";
        ctx.fillStyle = "#ccfbf1";
        ctx.fillText(`${type.toUpperCase()} ASSET PASSPORT TAG`, canvas.width / 2, 82);

        // Render QR onto off-screen element
        const tempDiv = document.createElement("div");
        tempDiv.style.display = "none";
        document.body.appendChild(tempDiv);

        new QRCode(tempDiv, {
            text: id,
            width: 380,
            height: 380,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        setTimeout(() => {
            const qrImg = tempDiv.querySelector("img") || tempDiv.querySelector("canvas");
            if (qrImg) ctx.drawImage(qrImg, (canvas.width - 380) / 2, 135, 380, 380);

            // Asset ID
            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 42px monospace";
            ctx.textAlign = "center";
            ctx.fillText(id, canvas.width / 2, 575);

            // Item Name
            ctx.fillStyle = "#334155";
            ctx.font = "bold 24px -apple-system, sans-serif";
            const shortName = name.length > 32 ? name.substring(0, 30) + "..." : name;
            ctx.fillText(shortName, canvas.width / 2, 620);

            // Sub text
            ctx.fillStyle = "#64748b";
            ctx.font = "18px -apple-system, sans-serif";
            ctx.fillText("OFFICIAL TRACKQR INVENTORY ASSET", canvas.width / 2, 660);

            // Footer bar
            ctx.fillStyle = "#0f172a";
            ctx.fillRect(14, 700, canvas.width - 28, 46);
            ctx.fillStyle = "#f8fafc";
            ctx.font = "bold 14px monospace";
            ctx.fillText(`SCAN WITH TRACKQR APP  •  AUTHENTICATED ASSET`, canvas.width / 2, 728);

            document.body.removeChild(tempDiv);

            const link = document.createElement("a");
            link.download = `TrackQR_${id}_Tag.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
            UIManager.showToast(`Downloaded QR Tag for ${id}`, "success");
        }, 150);
    }

    function printTag() {
        window.print();
    }

    return {
        renderQrCode,
        downloadQrPng,
        printTag
    };
})();


// =============================================================================
// 4. SMART QR SCANNER CONTROLLER (CAMERA STREAM & FILE DECODER)
// =============================================================================
const ScannerController = (function () {
    let html5QrCode = null;
    let isScanning = false;
    let lastScannedText = null;
    let lastScanTime = 0;
    let availableCameras = [];

    const elements = {
        cameraSelect: document.getElementById("cameraDeviceSelect"),
        startBtn: document.getElementById("startScannerBtn"),
        stopBtn: document.getElementById("stopScannerBtn"),
        viewport: document.querySelector(".scanner-viewport-wrapper"),
        idlePlaceholder: document.getElementById("scannerIdlePlaceholder"),
        statusDot: document.getElementById("scannerStatusDot"),
        statusMsg: document.getElementById("scannerStatusMessage"),
        fileInput: document.getElementById("qrFileInput"),
        fileDropzone: document.getElementById("qrFileDropzone"),
        scannedPanel: document.getElementById("scannedResultPanel"),
        scannedEmpty: document.getElementById("scannedEmptyMessage"),
        scannedDevice: document.getElementById("scannedDeviceDetails"),
        scannedStock: document.getElementById("scannedStockDetails"),
        scannedUnknown: document.getElementById("scannedUnknownAlert"),
        scannedBadge: document.getElementById("scannedResultBadge"),
        sessionList: document.getElementById("scannerSessionHistory")
    };

    function init() {
        if (!elements.startBtn) return;
        detectCameras();

        elements.startBtn.addEventListener("click", startScanner);
        elements.stopBtn.addEventListener("click", stopScanner);

        if (elements.fileDropzone && elements.fileInput) {
            elements.fileDropzone.addEventListener("click", () => elements.fileInput.click());
            elements.fileInput.addEventListener("change", handleFileScan);

            elements.fileDropzone.addEventListener("dragover", (e) => {
                e.preventDefault();
                elements.fileDropzone.style.borderColor = "var(--primary)";
            });
            elements.fileDropzone.addEventListener("dragleave", () => {
                elements.fileDropzone.style.borderColor = "var(--border-color)";
            });
            elements.fileDropzone.addEventListener("drop", (e) => {
                e.preventDefault();
                elements.fileDropzone.style.borderColor = "var(--border-color)";
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    decodeImageFile(e.dataTransfer.files[0]);
                }
            });
        }
    }

    async function detectCameras() {
        if (typeof Html5Qrcode === "undefined") {
            updateStatus("Html5Qrcode library not loaded.", "error");
            return;
        }

        try {
            availableCameras = await Html5Qrcode.getCameras();
            if (elements.cameraSelect) {
                elements.cameraSelect.innerHTML = "";
                if (availableCameras && availableCameras.length) {
                    availableCameras.forEach((cam, idx) => {
                        const opt = document.createElement("option");
                        opt.value = cam.id;
                        opt.textContent = cam.label || `Camera ${idx + 1}`;
                        elements.cameraSelect.appendChild(opt);
                    });
                    updateStatus(`Detected ${availableCameras.length} camera(s). Ready to scan.`);
                } else {
                    elements.cameraSelect.innerHTML = `<option value="">No camera detected</option>`;
                    updateStatus("No cameras found. You can still scan saved image files.", "idle");
                }
            }
        } catch (err) {
            console.warn("Camera enumeration note:", err);
            updateStatus("Camera access requires HTTPS or localhost permission.", "idle");
        }
    }

    async function startScanner() {
        if (isScanning) return;

        if (typeof Html5Qrcode === "undefined") {
            UIManager.showToast("Scanner library is missing.", "error");
            return;
        }

        try {
            html5QrCode = new Html5Qrcode("qrReaderVideo");
            const cameraId = elements.cameraSelect ? elements.cameraSelect.value : null;
            const cameraConfig = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "environment" };

            updateStatus("Initializing camera...", "active");

            await html5QrCode.start(
                cameraConfig,
                {
                    fps: 15,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0
                },
                (decodedText) => onScanSuccess(decodedText),
                (errorMessage) => { /* ignore per-frame read attempts */ }
            );

            isScanning = true;
            elements.startBtn.style.display = "none";
            elements.stopBtn.style.display = "inline-flex";
            if (elements.idlePlaceholder) elements.idlePlaceholder.style.display = "none";
            if (elements.viewport) elements.viewport.classList.add("scanning");
            updateStatus("Live camera active. Point at a TrackQR tag.", "active");
        } catch (err) {
            console.error("Camera startup error:", err);
            isScanning = false;
            let msg = "Could not start camera: " + (err.message || err);
            if (window.location.protocol === "file:") {
                msg += " (Note: Browsers block camera under file:// URLs. Run via http://localhost:5000)";
            }
            updateStatus(msg, "error");
            UIManager.showToast(msg, "error");
        }
    }

    async function stopScanner() {
        if (!isScanning || !html5QrCode) return;
        try {
            await html5QrCode.stop();
            await html5QrCode.clear();
        } catch (e) {
            console.warn("Camera stop error:", e);
        } finally {
            isScanning = false;
            html5QrCode = null;
            elements.startBtn.style.display = "inline-flex";
            elements.stopBtn.style.display = "none";
            if (elements.idlePlaceholder) elements.idlePlaceholder.style.display = "flex";
            if (elements.viewport) elements.viewport.classList.remove("scanning");
            updateStatus("Camera stopped. Ready to scan.", "idle");
        }
    }

    function onScanSuccess(decodedText) {
        const settings = StorageService.getSettings();
        const cooldown = parseInt(settings.scanCooldown, 10) || 2500;
        const now = Date.now();

        // Prevent rapid duplicate scans
        if (decodedText === lastScannedText && (now - lastScanTime) < cooldown) {
            return;
        }

        lastScannedText = decodedText;
        lastScanTime = now;

        UIManager.playBeepSound();
        handleScannedCode(decodedText.trim());
    }

    function handleFileScan(e) {
        if (e.target.files && e.target.files[0]) {
            decodeImageFile(e.target.files[0]);
        }
    }

    async function decodeImageFile(file) {
        if (!file) return;
        updateStatus(`Decoding image "${file.name}"...`, "active");

        try {
            const scanner = new Html5Qrcode("qrReaderVideo");
            const result = await scanner.scanFile(file, true);
            await scanner.clear();
            UIManager.playBeepSound();
            updateStatus(`Successfully decoded: ${result}`);
            handleScannedCode(result.trim());
        } catch (err) {
            updateStatus(`Failed to decode QR from image: ${err}`, "error");
            UIManager.showToast("No valid QR code found in selected image.", "error");
        }
    }

    async function handleScannedCode(rawCode) {
        if (!rawCode) return;
        const scannedId = rawCode.trim().toUpperCase();

        // Hide all scan result cards initially
        elements.scannedEmpty.style.display = "none";
        elements.scannedDevice.style.display = "none";
        elements.scannedStock.style.display = "none";
        elements.scannedUnknown.style.display = "none";

        // Query Backend for Real Entity
        try {
            const lookup = await StorageService.lookupQrCode(scannedId);
            if (lookup && lookup.found) {
                if (lookup.entityType === 'Device') {
                    renderScannedDevice(lookup.data);
                    addSessionHistory(lookup.data.id, "Device", true);
                } else if (lookup.entityType === 'Stock') {
                    renderScannedStock(lookup.data);
                    addSessionHistory(lookup.data.id, "Stock", true);
                }
                return;
            }
        } catch (e) {
            // Not found in backend
        }

        // Unknown Code
        renderScannedUnknown(scannedId);
        addSessionHistory(scannedId, "Unknown", false);
    }

    function renderScannedDevice(device) {
        elements.scannedBadge.textContent = "Device Verified";
        elements.scannedBadge.className = "badge available";
        elements.scannedDevice.style.display = "block";

        document.getElementById("scannedDeviceId").textContent = device.id;
        document.getElementById("scannedDeviceName").textContent = device.name;
        document.getElementById("scannedDeviceCategory").textContent = device.category;
        document.getElementById("scannedDeviceCondition").textContent = device.condition || "Good";
        document.getElementById("scannedDeviceLocation").textContent = device.location;
        document.getElementById("scannedDeviceAssigned").textContent = device.assignedTo ? `${device.assignedTo} (${device.department || ""})` : "Unassigned";
        document.getElementById("scannedDeviceSerial").textContent = device.serial || "N/A";

        const statusPill = document.getElementById("scannedDeviceStatus");
        statusPill.textContent = device.status;
        statusPill.className = `scanned-status-pill badge ${device.status.toLowerCase().replace(/\s+/g, "-")}`;

        // Render maintenance history snippet
        const maintList = device.maintenance || StorageService.getMaintenanceByDeviceId(device.id);
        const maintContainer = document.getElementById("scannedDeviceMaintList");
        maintContainer.innerHTML = "";
        if (maintList.length === 0) {
            maintContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">No repair tickets recorded. Device is healthy.</span>`;
        } else {
            maintList.forEach(m => {
                const item = document.createElement("div");
                item.style.padding = "4px 0";
                item.style.fontSize = "13px";
                item.innerHTML = `<strong>${m.id}</strong>: ${escapeHtml(m.title)} - <span class="badge ${m.status === "Completed" ? "available" : "maintenance"}">${m.status}</span>`;
                maintContainer.appendChild(item);
            });
        }

        // Quick status actions
        document.getElementById("scanDevSetAvailableBtn").onclick = () => updateScannedDeviceStatus(device.id, "Available");
        document.getElementById("scanDevSetInUseBtn").onclick = () => updateScannedDeviceStatus(device.id, "In Use");
        document.getElementById("scanDevSetMaintBtn").onclick = () => updateScannedDeviceStatus(device.id, "Under Maintenance");
        document.getElementById("scanDevPassportBtn").onclick = () => App.openPassportModal(device.id, 'device');
        document.getElementById("scanDevScheduleMaintBtn").onclick = () => App.openMaintenanceModal(device.id);

        UIManager.showToast(`Device recognized: ${device.name} (${device.id})`, "success");

        if (StorageService.getSettings().autoOpenModal) {
            App.openPassportModal(device.id, 'device');
        }
    }

    function renderScannedStock(stock) {
        elements.scannedBadge.textContent = "Stock Item Verified";
        elements.scannedBadge.className = "badge in-stock";
        elements.scannedStock.style.display = "block";

        document.getElementById("scannedStockId").textContent = stock.id;
        document.getElementById("scannedStockName").textContent = stock.name;
        document.getElementById("scannedStockCategory").textContent = stock.category;
        document.getElementById("scannedStockAvailable").textContent = `${stock.quantity} ${stock.unit}`;
        document.getElementById("scannedStockMinLevel").textContent = `${stock.minLevel} ${stock.unit}`;
        document.getElementById("scannedStockLocation").textContent = stock.location;
        document.getElementById("scannedStockUnit").textContent = stock.unit;
        document.getElementById("scannedStockCost").textContent = formatCurrency(stock.unitPrice);
        document.getElementById("scannedStockSupplier").textContent = stock.supplier || "N/A";

        const statusPill = document.getElementById("scannedStockStatus");
        if (stock.quantity === 0) {
            statusPill.textContent = "Out of Stock";
            statusPill.className = "scanned-status-pill badge out-of-stock";
        } else if (stock.quantity <= stock.minLevel) {
            statusPill.textContent = "Low Stock Alert";
            statusPill.className = "scanned-status-pill badge low-stock";
        } else {
            statusPill.textContent = "In Stock";
            statusPill.className = "scanned-status-pill badge in-stock";
        }

        // Instant movement triggers
        document.getElementById("scanStockInBtn").onclick = () => App.openStockMovementModal(stock.id, "Stock-In");
        document.getElementById("scanStockOutBtn").onclick = () => App.openStockMovementModal(stock.id, "Stock-Out");
        document.getElementById("scanStockReturnBtn").onclick = () => App.openStockMovementModal(stock.id, "Stock Return");
        document.getElementById("scanStockTagBtn").onclick = () => App.openPassportModal(stock.id, 'stock');

        UIManager.showToast(`Stock item recognized: ${stock.name} (${stock.quantity} ${stock.unit})`, "success");

        if (StorageService.getSettings().autoOpenModal) {
            App.openPassportModal(stock.id, 'stock');
        }
    }

    function renderScannedUnknown(scannedId) {
        elements.scannedBadge.textContent = "Unregistered QR";
        elements.scannedBadge.className = "badge maintenance";
        elements.scannedUnknown.style.display = "block";

        document.getElementById("unknownScannedIdTitle").textContent = `ID "${scannedId}" Not Found`;
        document.getElementById("unknownScannedIdMessage").textContent =
            `No registered Device or Stock Consumable matches "${scannedId}". Choose an option below to catalog it:`;

        document.getElementById("scannedCreateDeviceBtn").onclick = () => App.openAddDeviceModalWithId(scannedId);
        document.getElementById("scannedCreateStockBtn").onclick = () => App.openAddStockModalWithId(scannedId);

        UIManager.showToast(`Code "${scannedId}" is not in the system`, "warning");
    }

    async function updateScannedDeviceStatus(deviceId, newStatus) {
        try {
            await StorageService.updateDeviceStatus(deviceId, newStatus);
            UIManager.showToast(`Device status set to "${newStatus}"`, "success");
            await handleScannedCode(deviceId);
            App.refreshAllViews();
        } catch (e) {
            UIManager.showToast(`Failed to update status: ${e.message}`, "error");
        }
    }

    function addSessionHistory(id, entityType, isFound) {
        if (!elements.sessionList) return;
        const emptyHint = elements.sessionList.querySelector(".empty-hint");
        if (emptyHint) elements.sessionList.removeChild(emptyHint);

        const row = document.createElement("div");
        row.className = "session-scan-row";
        const badgeClass = isFound ? (entityType === "Device" ? "available" : "in-stock") : "out-of-stock";

        row.innerHTML = `
            <div>
                <strong style="font-family: monospace;">${escapeHtml(id)}</strong>
                <small style="color: var(--text-muted); margin-left: 6px;">[${entityType}] ${new Date().toLocaleTimeString()}</small>
            </div>
            <span class="badge ${badgeClass}">${isFound ? "Recognized" : "Unknown"}</span>
        `;
        elements.sessionList.prepend(row);
    }

    function updateStatus(message, state = "idle") {
        if (!elements.statusMsg) return;
        elements.statusMsg.textContent = message;
        elements.statusDot.className = "status-indicator-dot";
        if (state === "active") elements.statusDot.classList.add("active");
        if (state === "error") elements.statusDot.classList.add("error");
    }

    return {
        init,
        startScanner,
        stopScanner,
        handleScannedCode,
        isScanning: () => isScanning
    };
})();


// =============================================================================
// 5. MAIN APPLICATION CONTROLLER
// =============================================================================
const App = (function () {
    let activeTab = "dashboard";

    let deviceFilters = { search: "", category: "all", status: "all", condition: "all", sort: "name_asc" };
    let stockFilters = { search: "", category: "all", level: "all", sort: "name_asc" };
    let txFilters = { search: "", type: "all", item: "all" };
    let maintFilters = { search: "", status: "all", type: "all" };
    let activityFilters = { search: "", type: "all" };

    async function init() {
        setupNavigation();
        setupDashboard();
        setupDevices();
        setupStock();
        setupTransactions();
        setupMaintenance();
        setupCategories();
        setupActivity();
        setupSettings();
        setupPassportModal();
        setupMobileMenu();
        ScannerController.init();

        // 1. Initial Load from Backend API
        await StorageService.loadAllFromBackend();

        // 2. Apply Theme
        const settings = StorageService.getSettings();
        applyTheme(settings.theme || "light");

        // 3. Render all UI components
        refreshAllViews();

        // 4. Handle initial URL hash navigation
        const hash = window.location.hash.replace("#", "");
        if (hash && ["dashboard", "devices", "stock-items", "scanner", "stock-transactions", "maintenance", "activity", "categories", "settings"].includes(hash)) {
            switchTab(hash);
        }
    }

    // --- NAVIGATION & TABS ---
    function setupNavigation() {
        document.querySelectorAll(".sidebar-nav .nav-item").forEach(link => {
            link.addEventListener("click", function (e) {
                e.preventDefault();
                const tab = this.getAttribute("data-tab");
                switchTab(tab);
                closeMobileSidebar();
            });
        });

        document.getElementById("topbarScanBtn")?.addEventListener("click", () => switchTab("scanner"));
        document.getElementById("topbarAddDeviceBtn")?.addEventListener("click", () => openAddDeviceModal());
        document.getElementById("topbarAddStockBtn")?.addEventListener("click", () => openAddStockModal());
        document.getElementById("topbarStockMovementBtn")?.addEventListener("click", () => openStockMovementModal());

        document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);
    }

    function switchTab(tabId) {
        if (activeTab === "scanner" && tabId !== "scanner") {
            ScannerController.stopScanner();
        }

        activeTab = tabId;
        window.location.hash = tabId;

        document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
            if (item.getAttribute("data-tab") === tabId) item.classList.add("active");
            else item.classList.remove("active");
        });

        document.querySelectorAll(".tab-view").forEach(view => view.classList.remove("active"));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add("active");

        const titles = {
            dashboard: { title: "Unified Dashboard", breadcrumb: "SYSTEM / OVERVIEW" },
            devices: { title: "Device Management", breadcrumb: "HARDWARE / SERIALIZED DEVICES" },
            "stock-items": { title: "Stock & Consumables", breadcrumb: "SUPPLIES / QUANTITY MANAGEMENT" },
            scanner: { title: "Smart QR Scanner", breadcrumb: "SCANNER / DUAL RECOGNITION" },
            "stock-transactions": { title: "Stock Movement Ledger", breadcrumb: "AUDIT / STOCK MOVEMENTS" },
            maintenance: { title: "Device Maintenance", breadcrumb: "REPAIRS / WORK ORDERS" },
            activity: { title: "Activity Logs", breadcrumb: "AUDIT / SYSTEM TIMELINE" },
            categories: { title: "Categories Management", breadcrumb: "CLASSIFICATION / CATEGORIES" },
            settings: { title: "System Settings", breadcrumb: "CONFIGURATION / PREFERENCES" }
        };

        const info = titles[tabId] || titles.dashboard;
        document.getElementById("pageTitle").textContent = info.title;
        document.getElementById("pageBreadcrumb").textContent = info.breadcrumb;

        if (tabId === "dashboard") renderDashboard();
        if (tabId === "devices") renderDevices();
        if (tabId === "stock-items") renderStock();
        if (tabId === "stock-transactions") renderTransactions();
        if (tabId === "maintenance") renderMaintenance();
        if (tabId === "categories") renderCategories();
        if (tabId === "activity") renderActivity();
    }

    function setupMobileMenu() {
        const btn = document.getElementById("mobileMenuBtn");
        const sidebar = document.getElementById("sidebar");
        const overlay = document.getElementById("sidebarOverlay");

        btn?.addEventListener("click", () => {
            sidebar?.classList.toggle("open");
            overlay?.classList.toggle("open");
        });

        overlay?.addEventListener("click", closeMobileSidebar);
    }

    function closeMobileSidebar() {
        document.getElementById("sidebar")?.classList.remove("open");
        document.getElementById("sidebarOverlay")?.classList.remove("open");
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute("data-theme") || "light";
        const newTheme = current === "light" ? "dark" : "light";
        applyTheme(newTheme);
        StorageService.saveSettings({ theme: newTheme }).catch(() => {});
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
    }


    // =========================================================================
    // 5A. UNIFIED DASHBOARD
    // =========================================================================
    function setupDashboard() {
        const dateEl = document.getElementById("currentDateDisplay");
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        }

        document.getElementById("dashAddDeviceBtn")?.addEventListener("click", () => openAddDeviceModal());
        document.getElementById("dashAddStockItemBtn")?.addEventListener("click", () => openAddStockModal());
        document.getElementById("dashExecuteStockInBtn")?.addEventListener("click", () => openStockMovementModal(null, "Stock-In"));
        document.getElementById("dashExecuteStockOutBtn")?.addEventListener("click", () => openStockMovementModal(null, "Stock-Out"));
        document.getElementById("dashOpenScannerBtn")?.addEventListener("click", () => switchTab("scanner"));
        document.getElementById("dashManageCategoriesBtn")?.addEventListener("click", () => switchTab("categories"));
        document.getElementById("dashViewAllTxnBtn")?.addEventListener("click", () => switchTab("stock-transactions"));
        document.getElementById("dashViewAllActivityBtn")?.addEventListener("click", () => switchTab("activity"));
        document.getElementById("dashReviewAlertsBtn")?.addEventListener("click", () => switchTab("stock-items"));
    }

    function renderDashboard() {
        const devices = StorageService.getDevices();
        const stock = StorageService.getStock();
        const settings = StorageService.getSettings();
        const txns = StorageService.getStockTransactions();
        const logs = StorageService.getLogs();
        const maint = StorageService.getMaintenance();

        // Keep the dashboard greeting simple and consistent.
        // Organization branding remains available in the sidebar and settings.
        document.getElementById("welcomeHeading").textContent = "Welcome";
        const sidebarOrg = document.getElementById("sidebarOrgName");
        if (sidebarOrg && settings.orgName) {
            sidebarOrg.textContent = settings.orgName.toUpperCase();
        }

        // 1. Devices statistics
        const totalDevs = devices.length;
        const inUseDevs = devices.filter(d => d.status === "In Use").length;
        const maintDevs = devices.filter(d => d.status === "Under Maintenance").length;

        document.getElementById("dashTotalDevices").textContent = totalDevs;
        document.getElementById("dashInUseDevices").textContent = inUseDevs;
        document.getElementById("dashMaintenanceDevices").textContent = maintDevs;

        // 2. Stock statistics
        const totalStockSkus = stock.length;
        const totalStockUnits = stock.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
        const lowStock = stock.filter(s => s.quantity > 0 && s.quantity <= s.minLevel);
        const outStock = stock.filter(s => s.quantity === 0);
        const alertCount = lowStock.length + outStock.length;

        document.getElementById("dashTotalStockItems").textContent = totalStockSkus;
        document.getElementById("dashTotalStockQty").textContent = totalStockUnits.toLocaleString();
        document.getElementById("dashStockAlerts").textContent = alertCount;

        // Banner
        const alertBanner = document.getElementById("dashAlertBanner");
        if (alertCount > 0) {
            alertBanner.style.display = "flex";
            document.getElementById("dashAlertBannerHeading").textContent = `${alertCount} Supplies Require Attention`;
            document.getElementById("dashAlertBannerText").textContent =
                `${outStock.length} items out of stock, ${lowStock.length} items below minimum safety threshold.`;
        } else {
            alertBanner.style.display = "none";
        }

        // Nav Badges
        document.getElementById("navDevicesCount").textContent = totalDevs;
        const stockAlertBadge = document.getElementById("navStockAlertCount");
        if (alertCount > 0) {
            stockAlertBadge.style.display = "inline-flex";
            stockAlertBadge.textContent = alertCount;
        } else {
            stockAlertBadge.style.display = "none";
        }
        document.getElementById("navMaintenanceCount").textContent = maint.filter(m => m.status !== "Completed").length;
        document.getElementById("storageItemCount").textContent = `${totalDevs} Devices • ${totalStockSkus} Stock SKUs`;

        // 3. Recent Transactions Table
        const txTbody = document.getElementById("dashRecentTransactionsTable");
        txTbody.innerHTML = "";
        const latestTxns = txns.slice(0, 5);
        if (latestTxns.length === 0) {
            txTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 18px;">No stock transactions logged yet.</td></tr>`;
        } else {
            latestTxns.forEach(t => {
                const tr = document.createElement("tr");
                const typeClass = t.type === "Stock-In" ? "positive" : t.type === "Stock-Out" ? "warning" : "primary";
                tr.innerHTML = `
                    <td><strong>${escapeHtml(t.id)}</strong></td>
                    <td>${escapeHtml(t.stockName)} <small class="text-muted">(${escapeHtml(t.stockId)})</small></td>
                    <td><span class="badge ${typeClass}">${escapeHtml(t.type)}</span></td>
                    <td>${t.type === "Stock-Out" ? "-" : "+"}${t.quantity}</td>
                    <td><strong>${t.newQty}</strong></td>
                    <td>${formatDate(t.timestamp)}</td>
                    <td>${escapeHtml(t.reference || "–")}</td>
                `;
                txTbody.appendChild(tr);
            });
        }

        // 4. Category Breakdown Bars
        const catContainer = document.getElementById("dashCategoryBars");
        catContainer.innerHTML = "";
        const devCats = StorageService.getDeviceCategories();
        if (devCats.length === 0) {
            catContainer.innerHTML = `<p class="empty-hint">No categories defined.</p>`;
        } else {
            devCats.forEach(c => {
                const count = devices.filter(d => d.category === c.name).length;
                const pct = totalDevs > 0 ? Math.round((count / totalDevs) * 100) : 0;
                const bar = document.createElement("div");
                bar.className = "category-bar-row";
                bar.innerHTML = `
                    <div class="category-bar-header">
                        <span>${escapeHtml(c.name)}</span>
                        <span><strong>${count}</strong> (${pct}%)</span>
                    </div>
                    <div class="category-progress-track">
                        <div class="category-progress-fill" style="width: ${pct}%;"></div>
                    </div>
                `;
                catContainer.appendChild(bar);
            });
        }

        // 5. Recent Activity Feed
        const actContainer = document.getElementById("dashRecentActivityList");
        actContainer.innerHTML = "";
        const latestLogs = logs.slice(0, 5);
        if (latestLogs.length === 0) {
            actContainer.innerHTML = `<p class="empty-hint">No recent system activity.</p>`;
        } else {
            latestLogs.forEach(log => {
                actContainer.appendChild(createActivityItemNode(log));
            });
        }
    }


    // =========================================================================
    // 5B. DEVICE MANAGEMENT MODULE
    // =========================================================================
    function setupDevices() {
        const searchInput = document.getElementById("deviceSearchInput");
        const clearBtn = document.getElementById("deviceClearSearchBtn");
        const catSelect = document.getElementById("deviceFilterCategory");
        const statusSelect = document.getElementById("deviceFilterStatus");
        const condSelect = document.getElementById("deviceFilterCondition");
        const sortSelect = document.getElementById("deviceFilterSort");
        const resetBtn = document.getElementById("deviceFilterResetBtn");

        searchInput?.addEventListener("input", function () {
            deviceFilters.search = this.value.trim().toLowerCase();
            renderDevices();
        });

        clearBtn?.addEventListener("click", () => {
            searchInput.value = "";
            deviceFilters.search = "";
            renderDevices();
        });

        catSelect?.addEventListener("change", function () { deviceFilters.category = this.value; renderDevices(); });
        statusSelect?.addEventListener("change", function () { deviceFilters.status = this.value; renderDevices(); });
        condSelect?.addEventListener("change", function () { deviceFilters.condition = this.value; renderDevices(); });
        sortSelect?.addEventListener("change", function () { deviceFilters.sort = this.value; renderDevices(); });

        resetBtn?.addEventListener("click", () => {
            searchInput.value = "";
            catSelect.value = "all";
            statusSelect.value = "all";
            condSelect.value = "all";
            sortSelect.value = "name_asc";
            deviceFilters = { search: "", category: "all", status: "all", condition: "all", sort: "name_asc" };
            renderDevices();
        });

        document.getElementById("deviceAddBtn")?.addEventListener("click", () => openAddDeviceModal());
        document.getElementById("deviceEmptyAddBtn")?.addEventListener("click", () => openAddDeviceModal());
        document.getElementById("deviceExportBtn")?.addEventListener("click", exportDevicesCSV);

        setupDeviceModal();
    }

    function renderDevices() {
        const devices = StorageService.getDevices();
        const categories = StorageService.getDeviceCategories();

        // Populate Category Dropdown
        const catSelect = document.getElementById("deviceFilterCategory");
        if (catSelect) {
            const current = catSelect.value;
            catSelect.innerHTML = `<option value="all">All Categories</option>`;
            categories.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.name;
                opt.textContent = c.name;
                catSelect.appendChild(opt);
            });
            catSelect.value = current || "all";
        }

        let filtered = devices.filter(d => {
            if (deviceFilters.search) {
                const s = deviceFilters.search;
                const mName = (d.name || "").toLowerCase().includes(s);
                const mId = (d.id || "").toLowerCase().includes(s);
                const mSerial = (d.serial || "").toLowerCase().includes(s);
                const mLoc = (d.location || "").toLowerCase().includes(s);
                const mUser = (d.assignedTo || "").toLowerCase().includes(s);
                if (!mName && !mId && !mSerial && !mLoc && !mUser) return false;
            }
            if (deviceFilters.category !== "all" && d.category !== deviceFilters.category) return false;
            if (deviceFilters.status !== "all" && d.status !== deviceFilters.status) return false;
            if (deviceFilters.condition !== "all" && d.condition !== deviceFilters.condition) return false;
            return true;
        });

        filtered.sort((a, b) => {
            switch (deviceFilters.sort) {
                case "name_desc": return b.name.localeCompare(a.name);
                case "id_asc": return a.id.localeCompare(b.id, undefined, { numeric: true });
                case "id_desc": return b.id.localeCompare(a.id, undefined, { numeric: true });
                case "date_desc": return new Date(b.purchaseDate) - new Date(a.purchaseDate);
                case "cost_desc": return (parseFloat(b.cost) || 0) - (parseFloat(a.cost) || 0);
                case "name_asc":
                default:
                    return a.name.localeCompare(b.name);
            }
        });

        document.getElementById("deviceResultsCount").textContent = `Showing ${filtered.length} of ${devices.length} registered devices`;

        const tbody = document.getElementById("deviceTableBody");
        const emptyState = document.getElementById("deviceEmptyState");
        tbody.innerHTML = "";

        if (filtered.length === 0) {
            tbody.parentElement.style.display = "none";
            emptyState.style.display = "block";
        } else {
            tbody.parentElement.style.display = "";
            emptyState.style.display = "none";

            filtered.forEach(dev => {
                const tr = document.createElement("tr");
                const statusClass = dev.status.toLowerCase().replace(/\s+/g, "-");

                tr.innerHTML = `
                    <td><span class="asset-id-pill" onclick="App.openPassportModal('${dev.id}', 'device')">${escapeHtml(dev.id)}</span></td>
                    <td><strong>${escapeHtml(dev.name)}</strong></td>
                    <td>${escapeHtml(dev.category)}</td>
                    <td><span style="font-family: monospace; font-size: 11px;">${escapeHtml(dev.serial || "N/A")}</span></td>
                    <td>${escapeHtml(dev.location)}</td>
                    <td>${dev.assignedTo ? `${escapeHtml(dev.assignedTo)} <small class="text-muted">(${escapeHtml(dev.department || "")})</small>` : "Unassigned"}</td>
                    <td><span class="badge condition-badge">${escapeHtml(dev.condition || "Good")}</span></td>
                    <td><span class="badge ${statusClass}">${escapeHtml(dev.status)}</span></td>
                    <td>
                        <button class="qr-thumb-btn" onclick="App.openPassportModal('${dev.id}', 'device')" title="View Tag & Passport">
                            <svg class="icon-inline" style="width: 14px; height: 14px;"><use href="#icon-qr"/></svg>
                            <span>QR</span>
                        </button>
                    </td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-ghost" onclick="App.openPassportModal('${dev.id}', 'device')" title="Details">
                            <svg class="icon-inline"><use href="#icon-dashboard"/></svg>
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="App.openEditDeviceModal('${dev.id}')" title="Edit">
                            <svg class="icon-inline"><use href="#icon-edit"/></svg>
                        </button>
                        <button class="btn btn-sm btn-danger-ghost" onclick="App.deleteDevicePrompt('${dev.id}')" title="Delete">
                            <svg class="icon-inline"><use href="#icon-trash"/></svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    function setupDeviceModal() {
        const modal = document.getElementById("deviceModal");
        const form = document.getElementById("deviceModalForm");
        const closeBtn = document.getElementById("closeDeviceModalBtn");
        const cancelBtn = document.getElementById("cancelDeviceModalBtn");
        const catSelect = document.getElementById("inputDeviceCategory");
        const regenBtn = document.getElementById("regenerateDeviceIdBtn");

        closeBtn?.addEventListener("click", closeDeviceModal);
        cancelBtn?.addEventListener("click", closeDeviceModal);

        catSelect?.addEventListener("change", function () {
            if (document.getElementById("deviceFormMode").value === "add") {
                document.getElementById("inputDeviceId").value = generateNextDeviceId(this.value);
            }
        });

        regenBtn?.addEventListener("click", function () {
            const cat = catSelect.value;
            if (!cat) {
                UIManager.showToast("Select a device category first to generate an ID", "warning");
                return;
            }
            document.getElementById("inputDeviceId").value = generateNextDeviceId(cat);
        });

        form?.addEventListener("submit", async function (e) {
            e.preventDefault();

            const mode = document.getElementById("deviceFormMode").value;
            const originalId = document.getElementById("deviceFormOriginalId").value;
            const id = document.getElementById("inputDeviceId").value.trim().toUpperCase();
            const name = document.getElementById("inputDeviceName").value.trim();
            const category = document.getElementById("inputDeviceCategory").value;
            const serial = document.getElementById("inputDeviceSerial").value.trim();
            const location = document.getElementById("inputDeviceLocation").value.trim();
            const status = document.getElementById("inputDeviceStatus").value;
            const condition = document.getElementById("inputDeviceCondition").value;
            const purchaseDate = document.getElementById("inputDeviceDate").value;
            const cost = parseFloat(document.getElementById("inputDeviceCost").value) || 0;
            const assignedTo = document.getElementById("inputDeviceAssigned").value.trim();
            const notes = document.getElementById("inputDeviceNotes").value.trim();

            document.getElementById("errorDeviceId").textContent = "";
            document.getElementById("errorDeviceSerial").textContent = "";

            if (!id || !name || !category || !serial || !location || !purchaseDate) {
                UIManager.showToast("Please fill in all required fields marked with *", "error");
                return;
            }

            const devicePayload = {
                id,
                name,
                category,
                serial,
                location,
                assignedTo,
                department: "",
                purchaseDate,
                cost,
                condition,
                status,
                notes
            };

            try {
                await StorageService.saveDevice(devicePayload, mode === "edit", originalId);
                closeDeviceModal();
                refreshAllViews();
                UIManager.showToast(`Device "${name}" (${id}) saved successfully!`, "success");
                // Show the generated QR passport immediately after a new device is created.
                if (mode === "add") setTimeout(() => openPassportModal(id, "device"), 120);
            } catch (err) {
                if (err.message.includes("Serial")) {
                    document.getElementById("errorDeviceSerial").textContent = err.message;
                } else {
                    document.getElementById("errorDeviceId").textContent = err.message;
                }
                UIManager.showToast(err.message, "error");
            }
        });
    }

    function generateNextDeviceId(catName) {
        if (!catName) return "DEV-AST-001";
        const cat = StorageService.getDeviceCategories().find(c => c.name === catName);
        const prefix = cat ? `DEV-${cat.prefix.toUpperCase()}` : "DEV-AST";

        const devs = StorageService.getDevices();
        const regex = new RegExp(`^${prefix}-(\\d+)`, "i");
        let maxNum = 0;
        devs.forEach(d => {
            const m = d.id.match(regex);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > maxNum) maxNum = n;
            }
        });
        return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
    }

    function openAddDeviceModal() {
        const modal = document.getElementById("deviceModal");
        const form = document.getElementById("deviceModalForm");
        form.reset();

        document.getElementById("deviceModalTitle").textContent = "Register New Device";
        document.getElementById("deviceFormMode").value = "add";
        document.getElementById("deviceFormOriginalId").value = "";
        document.getElementById("errorDeviceId").textContent = "";
        document.getElementById("errorDeviceSerial").textContent = "";

        const catSelect = document.getElementById("inputDeviceCategory");
        catSelect.innerHTML = `<option value="">Select Category</option>`;
        StorageService.getDeviceCategories().forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.name;
            opt.textContent = `${c.name} (${c.prefix})`;
            catSelect.appendChild(opt);
        });

        document.getElementById("inputDeviceDate").value = new Date().toISOString().split("T")[0];
        modal.classList.add("active");
    }

    function openAddDeviceModalWithId(id) {
        openAddDeviceModal();
        document.getElementById("inputDeviceId").value = id.toUpperCase();
    }

    function openEditDeviceModal(id) {
        const dev = StorageService.getDeviceById(id);
        if (!dev) return;

        openAddDeviceModal();
        document.getElementById("deviceModalTitle").textContent = `Edit Device (${dev.id})`;
        document.getElementById("deviceFormMode").value = "edit";
        document.getElementById("deviceFormOriginalId").value = dev.id;

        document.getElementById("inputDeviceName").value = dev.name;
        document.getElementById("inputDeviceCategory").value = dev.category;
        document.getElementById("inputDeviceId").value = dev.id;
        document.getElementById("inputDeviceSerial").value = dev.serial;
        document.getElementById("inputDeviceLocation").value = dev.location;
        document.getElementById("inputDeviceStatus").value = dev.status;
        document.getElementById("inputDeviceCondition").value = dev.condition || "Good";
        document.getElementById("inputDeviceDate").value = dev.purchaseDate;
        document.getElementById("inputDeviceCost").value = dev.cost || "";
        document.getElementById("inputDeviceAssigned").value = dev.assignedTo || "";
        document.getElementById("inputDeviceNotes").value = dev.notes || "";
    }

    function closeDeviceModal() {
        document.getElementById("deviceModal")?.classList.remove("active");
    }

    function deleteDevicePrompt(id) {
        const dev = StorageService.getDeviceById(id);
        if (!dev) return;

        UIManager.confirmAction(
            `Permanently delete device "${dev.name}" (${dev.id}) and all of its repair history? This action is stored in the database.`,
            async () => {
                try {
                    await StorageService.deleteDevice(id);
                    refreshAllViews();
                    UIManager.showToast(`Device ${id} deleted from database.`, "info");
                } catch (e) {
                    UIManager.showToast(`Delete failed: ${e.message}`, "error");
                }
            },
            "Delete Device Asset"
        );
    }

    function exportDevicesCSV() {
        const devs = StorageService.getDevices();
        if (devs.length === 0) {
            UIManager.showToast("No devices to export.", "warning");
            return;
        }

        const headers = ["Asset ID", "Device Name", "Category", "Serial Number", "Condition", "Status", "Location", "Assigned Person", "Purchase Date", "Cost", "Notes"];
        const rows = devs.map(d => [
            `"${d.id}"`,
            `"${(d.name || "").replace(/"/g, '""')}"`,
            `"${d.category}"`,
            `"${(d.serial || "").replace(/"/g, '""')}"`,
            `"${d.condition || ""}"`,
            `"${d.status}"`,
            `"${(d.location || "").replace(/"/g, '""')}"`,
            `"${(d.assignedTo || "").replace(/"/g, '""')}"`,
            `"${d.purchaseDate}"`,
            `"${d.cost || 0}"`,
            `"${(d.notes || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `TrackQR_Devices_${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
    }


    // =========================================================================
    // 5C. STOCK & CONSUMABLES MODULE
    // =========================================================================
    function setupStock() {
        const searchInput = document.getElementById("stockSearchInput");
        const clearBtn = document.getElementById("stockClearSearchBtn");
        const catSelect = document.getElementById("stockFilterCategory");
        const levelSelect = document.getElementById("stockFilterLevel");
        const sortSelect = document.getElementById("stockFilterSort");
        const resetBtn = document.getElementById("stockFilterResetBtn");

        searchInput?.addEventListener("input", function () {
            stockFilters.search = this.value.trim().toLowerCase();
            renderStock();
        });

        clearBtn?.addEventListener("click", () => {
            searchInput.value = "";
            stockFilters.search = "";
            renderStock();
        });

        catSelect?.addEventListener("change", function () { stockFilters.category = this.value; renderStock(); });
        levelSelect?.addEventListener("change", function () { stockFilters.level = this.value; renderStock(); });
        sortSelect?.addEventListener("change", function () { stockFilters.sort = this.value; renderStock(); });

        resetBtn?.addEventListener("click", () => {
            searchInput.value = "";
            catSelect.value = "all";
            levelSelect.value = "all";
            sortSelect.value = "name_asc";
            stockFilters = { search: "", category: "all", level: "all", sort: "name_asc" };
            renderStock();
        });

        document.getElementById("stockAddBtn")?.addEventListener("click", () => openAddStockModal());
        document.getElementById("stockEmptyAddBtn")?.addEventListener("click", () => openAddStockModal());
        document.getElementById("stockExportBtn")?.addEventListener("click", exportStockCSV);

        setupStockModal();
        setupQuickMoveModal();
    }

    function renderStock() {
        const stock = StorageService.getStock();
        const categories = StorageService.getStockCategories();

        // Update Stock Tab KPI Summary Cards
        const kpiTotalItems = document.getElementById("stockKpiTotalItems");
        const kpiTotalUnits = document.getElementById("stockKpiTotalUnits");
        const kpiLowCount = document.getElementById("stockKpiLowCount");
        const kpiOutCount = document.getElementById("stockKpiOutCount");

        if (kpiTotalItems) kpiTotalItems.textContent = stock.length;
        if (kpiTotalUnits) kpiTotalUnits.textContent = stock.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 0), 0);
        if (kpiLowCount) kpiLowCount.textContent = stock.filter(item => item.quantity > 0 && item.quantity <= item.minLevel).length;
        if (kpiOutCount) kpiOutCount.textContent = stock.filter(item => item.quantity === 0).length;

        const catSelect = document.getElementById("stockFilterCategory");
        if (catSelect) {
            const current = catSelect.value;
            catSelect.innerHTML = `<option value="all">All Stock Categories</option>`;
            categories.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.name;
                opt.textContent = c.name;
                catSelect.appendChild(opt);
            });
            catSelect.value = current || "all";
        }

        let filtered = stock.filter(s => {
            if (stockFilters.search) {
                const q = stockFilters.search;
                const mName = (s.name || "").toLowerCase().includes(q);
                const mId = (s.id || "").toLowerCase().includes(q);
                const mLoc = (s.location || "").toLowerCase().includes(q);
                const mSup = (s.supplier || "").toLowerCase().includes(q);
                if (!mName && !mId && !mLoc && !mSup) return false;
            }
            if (stockFilters.category !== "all" && s.category !== stockFilters.category) return false;
            if (stockFilters.level !== "all") {
                if (stockFilters.level === "out" && s.quantity !== 0) return false;
                if (stockFilters.level === "low" && !(s.quantity > 0 && s.quantity <= s.minLevel)) return false;
                if (stockFilters.level === "normal" && !(s.quantity > s.minLevel)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => {
            switch (stockFilters.sort) {
                case "name_desc": return b.name.localeCompare(a.name);
                case "id_asc": return a.id.localeCompare(b.id, undefined, { numeric: true });
                case "id_desc": return b.id.localeCompare(a.id, undefined, { numeric: true });
                case "qty_asc": return a.quantity - b.quantity;
                case "qty_desc": return b.quantity - a.quantity;
                case "price_desc": return (parseFloat(b.unitPrice) || 0) - (parseFloat(a.unitPrice) || 0);
                case "name_asc":
                default:
                    return a.name.localeCompare(b.name);
            }
        });

        document.getElementById("stockResultsCount").textContent = `Showing ${filtered.length} of ${stock.length} cataloged stock items`;

        const tbody = document.getElementById("stockTableBody");
        const emptyState = document.getElementById("stockEmptyState");
        tbody.innerHTML = "";

        if (filtered.length === 0) {
            tbody.parentElement.style.display = "none";
            emptyState.style.display = "block";
        } else {
            tbody.parentElement.style.display = "";
            emptyState.style.display = "none";

            filtered.forEach(stk => {
                const tr = document.createElement("tr");

                let statusBadge = `<span class="badge in-stock">In Stock</span>`;
                let qtyClass = "";

                if (stk.quantity === 0) {
                    statusBadge = `<span class="badge out-of-stock">Out of Stock</span>`;
                    qtyClass = "zero";
                } else if (stk.quantity <= stk.minLevel) {
                    statusBadge = `<span class="badge low-stock">Low Stock</span>`;
                    qtyClass = "low";
                }

                tr.innerHTML = `
                    <td><span class="asset-id-pill stock-id-pill" onclick="App.openPassportModal('${stk.id}', 'stock')">${escapeHtml(stk.id)}</span></td>
                    <td><strong>${escapeHtml(stk.name)}</strong></td>
                    <td>${escapeHtml(stk.category)}</td>
                    <td><span class="qty-pill ${qtyClass}">${stk.quantity} ${escapeHtml(stk.unit)}</span></td>
                    <td>${stk.minLevel} ${escapeHtml(stk.unit)}</td>
                    <td>${escapeHtml(stk.location)}</td>
                    <td>${formatCurrency(stk.unitPrice)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="qr-thumb-btn" onclick="App.openPassportModal('${stk.id}', 'stock')" title="View Tag & Passport">
                            <svg class="icon-inline" style="width: 14px; height: 14px;"><use href="#icon-qr"/></svg>
                            <span>QR</span>
                        </button>
                    </td>
                    <td class="text-right">
                        <div class="action-row-sm" style="display: inline-flex; gap: 4px;">
                            <button class="btn btn-sm btn-outline-success" onclick="App.openStockMovementModal('${stk.id}', 'Stock-In')" title="Quick Stock-In">+</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="App.openStockMovementModal('${stk.id}', 'Stock-Out')" title="Quick Stock-Out" ${stk.quantity === 0 ? "disabled" : ""}>-</button>
                            <button class="btn btn-sm btn-ghost" onclick="App.openPassportModal('${stk.id}', 'stock')" title="View Full Passport">
                                <svg class="icon-inline"><use href="#icon-dashboard"/></svg>
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="App.openEditStockModal('${stk.id}')" title="Edit">
                                <svg class="icon-inline"><use href="#icon-edit"/></svg>
                            </button>
                            <button class="btn btn-sm btn-danger-ghost" onclick="App.deleteStockPrompt('${stk.id}')" title="Delete">
                                <svg class="icon-inline"><use href="#icon-trash"/></svg>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    function setupStockModal() {
        const modal = document.getElementById("stockModal");
        const form = document.getElementById("stockModalForm");
        const closeBtn = document.getElementById("closeStockModalBtn");
        const cancelBtn = document.getElementById("cancelStockModalBtn");
        const catSelect = document.getElementById("inputStockCategory");
        const regenBtn = document.getElementById("regenerateStockIdBtn");

        closeBtn?.addEventListener("click", closeStockModal);
        cancelBtn?.addEventListener("click", closeStockModal);

        catSelect?.addEventListener("change", function () {
            if (document.getElementById("stockFormMode").value === "add") {
                document.getElementById("inputStockId").value = generateNextStockId(this.value);
            }
        });

        regenBtn?.addEventListener("click", function () {
            const cat = catSelect.value;
            if (!cat) {
                UIManager.showToast("Select a category first to generate a stock ID", "warning");
                return;
            }
            document.getElementById("inputStockId").value = generateNextStockId(cat);
        });

        form?.addEventListener("submit", async function (e) {
            e.preventDefault();

            const mode = document.getElementById("stockFormMode").value;
            const originalId = document.getElementById("stockFormOriginalId").value;
            const id = document.getElementById("inputStockId").value.trim().toUpperCase();
            const name = document.getElementById("inputStockName").value.trim();
            const category = document.getElementById("inputStockCategory").value;
            const quantity = parseInt(document.getElementById("inputStockQuantity").value, 10) || 0;
            const minLevel = parseInt(document.getElementById("inputStockMinLevel").value, 10) || 5;
            const unit = document.getElementById("inputStockUnit").value;
            const location = document.getElementById("inputStockLocation").value.trim();
            const unitPrice = parseFloat(document.getElementById("inputStockUnitCost").value) || 0;
            const supplier = document.getElementById("inputStockSupplier").value.trim();
            const notes = document.getElementById("inputStockNotes").value.trim();

            document.getElementById("errorStockId").textContent = "";

            if (!id || !name || !category || !location) {
                UIManager.showToast("Please fill in required fields marked with *", "error");
                return;
            }

            const stockPayload = {
                id,
                name,
                category,
                quantity,
                minLevel,
                unit,
                location,
                unitPrice,
                supplier,
                notes
            };

            try {
                await StorageService.saveStock(stockPayload, mode === "edit", originalId);
                closeStockModal();
                refreshAllViews();
                UIManager.showToast(`Stock item "${name}" (${id}) saved.`, "success");
                if (mode === "add") setTimeout(() => openPassportModal(id, "stock"), 120);
            } catch (err) {
                document.getElementById("errorStockId").textContent = err.message;
                UIManager.showToast(err.message, "error");
            }
        });
    }

    function generateNextStockId(catName) {
        if (!catName) return "STK-GEN-001";
        const cat = StorageService.getStockCategories().find(c => c.name === catName);
        const prefix = cat ? `STK-${cat.prefix.toUpperCase()}` : "STK-GEN";

        const stock = StorageService.getStock();
        const regex = new RegExp(`^${prefix}-(\\d+)`, "i");
        let maxNum = 0;
        stock.forEach(s => {
            const m = s.id.match(regex);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > maxNum) maxNum = n;
            }
        });
        return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
    }

    function openAddStockModal() {
        const modal = document.getElementById("stockModal");
        const form = document.getElementById("stockModalForm");
        form.reset();

        document.getElementById("stockModalTitle").textContent = "Add Stock Item";
        document.getElementById("stockFormMode").value = "add";
        document.getElementById("stockFormOriginalId").value = "";
        document.getElementById("errorStockId").textContent = "";

        const catSelect = document.getElementById("inputStockCategory");
        catSelect.innerHTML = `<option value="">Select Category</option>`;
        StorageService.getStockCategories().forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.name;
            opt.textContent = `${c.name} (${c.prefix})`;
            catSelect.appendChild(opt);
        });

        document.getElementById("inputStockQuantity").disabled = false;
        document.getElementById("inputStockQuantity").value = "10";
        document.getElementById("inputStockMinLevel").value = "5";
        modal.classList.add("active");
    }

    function openAddStockModalWithId(id) {
        openAddStockModal();
        document.getElementById("inputStockId").value = id.toUpperCase();
    }

    function openEditStockModal(id) {
        const stk = StorageService.getStockById(id);
        if (!stk) return;

        openAddStockModal();
        document.getElementById("stockModalTitle").textContent = `Edit Stock Item (${stk.id})`;
        document.getElementById("stockFormMode").value = "edit";
        document.getElementById("stockFormOriginalId").value = stk.id;

        document.getElementById("inputStockName").value = stk.name;
        document.getElementById("inputStockCategory").value = stk.category;
        document.getElementById("inputStockId").value = stk.id;
        document.getElementById("inputStockQuantity").value = stk.quantity;
        document.getElementById("inputStockQuantity").disabled = true; // Use movement modal to alter stock levels
        document.getElementById("inputStockMinLevel").value = stk.minLevel;
        document.getElementById("inputStockUnit").value = stk.unit || "pcs";
        document.getElementById("inputStockLocation").value = stk.location;
        document.getElementById("inputStockUnitCost").value = stk.unitPrice || "";
        document.getElementById("inputStockSupplier").value = stk.supplier || "";
        document.getElementById("inputStockNotes").value = stk.notes || "";
    }

    function closeStockModal() {
        document.getElementById("stockModal")?.classList.remove("active");
    }

    function deleteStockPrompt(id) {
        const stk = StorageService.getStockById(id);
        if (!stk) return;

        UIManager.confirmAction(
            `Permanently delete stock item "${stk.name}" (${stk.id}) and all linked movement history?`,
            async () => {
                try {
                    await StorageService.deleteStock(id);
                    refreshAllViews();
                    UIManager.showToast(`Stock item ${id} deleted.`, "info");
                } catch (e) {
                    UIManager.showToast(`Delete failed: ${e.message}`, "error");
                }
            },
            "Delete Stock Item"
        );
    }

    function exportStockCSV() {
        const stock = StorageService.getStock();
        if (stock.length === 0) {
            UIManager.showToast("No stock items to export.", "warning");
            return;
        }

        const headers = ["Stock ID", "Item Name", "Category", "Quantity", "Min Level", "Unit", "Location", "Unit Price", "Supplier", "Notes"];
        const rows = stock.map(s => [
            `"${s.id}"`,
            `"${(s.name || "").replace(/"/g, '""')}"`,
            `"${s.category}"`,
            s.quantity,
            s.minLevel,
            `"${s.unit}"`,
            `"${(s.location || "").replace(/"/g, '""')}"`,
            s.unitPrice || 0,
            `"${(s.supplier || "").replace(/"/g, '""')}"`,
            `"${(s.notes || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `TrackQR_Stock_${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
    }


    // =========================================================================
    // 5D. STOCK MOVEMENT MODAL (Stock-In, Stock-Out, Return)
    // =========================================================================
    function setupQuickMoveModal() {
        const modal = document.getElementById("stockMovementModal");
        const form = document.getElementById("quickMoveForm");
        const closeBtn = document.getElementById("closeQuickMoveModalBtn");
        const cancelBtn = document.getElementById("cancelQuickMoveBtn");
        const typeSelect = document.getElementById("quickMoveType");
        const qtyInput = document.getElementById("quickMoveQty");
        const itemSelect = document.getElementById("quickMoveItemSelect");

        closeBtn?.addEventListener("click", closeStockMovementModal);
        cancelBtn?.addEventListener("click", closeStockMovementModal);

        typeSelect?.addEventListener("change", updateMovementPreview);
        qtyInput?.addEventListener("input", updateMovementPreview);

        itemSelect?.addEventListener("change", function () {
            const selectedId = this.value;
            const item = StorageService.getStockById(selectedId);
            if (item) {
                document.getElementById("quickMoveStockItemId").value = item.id;
                document.getElementById("quickMoveItemName").textContent = item.name;
                document.getElementById("quickMoveItemMeta").textContent = `ID: ${item.id} | Available Stock: ${item.quantity} ${item.unit} | Location: ${item.location}`;
                const partyInput = document.getElementById("quickMoveParty");
                if (partyInput && !partyInput.value) {
                    partyInput.value = item.supplier || "";
                }
                updateMovementPreview();
            }
        });

        form?.addEventListener("submit", async function (e) {
            e.preventDefault();

            const stockId = document.getElementById("quickMoveStockItemId").value;
            const moveType = typeSelect.value;
            const qty = parseInt(qtyInput.value, 10);
            const party = document.getElementById("quickMoveParty").value.trim();
            const ref = document.getElementById("quickMoveRef").value.trim();
            const notes = document.getElementById("quickMoveNotes").value.trim();

            if (!stockId) {
                UIManager.showToast("Please select a stock item.", "error");
                return;
            }

            if (isNaN(qty) || qty <= 0) {
                UIManager.showToast("Please enter a valid quantity greater than zero.", "error");
                return;
            }

            const referenceString = [party, ref].filter(Boolean).join(" • ");

            try {
                const res = await StorageService.performStockMovement(stockId, moveType, qty, referenceString, notes);
                closeStockMovementModal();
                refreshAllViews();
                UIManager.showToast(`Recorded ${moveType} for ${res.item.name}. New Balance: ${res.item.quantity} ${res.item.unit}`, "success");
            } catch (err) {
                document.getElementById("quickMoveQtyError").style.display = "block";
                document.getElementById("quickMoveQtyError").textContent = err.message;
                UIManager.showToast(err.message, "error");
            }
        });
    }

    function updateMovementPreview() {
        const stockId = document.getElementById("quickMoveStockItemId").value;
        const item = StorageService.getStockById(stockId);
        if (!item) return;

        const moveType = document.getElementById("quickMoveType").value;
        const qty = parseInt(document.getElementById("quickMoveQty").value, 10) || 0;
        const errEl = document.getElementById("quickMoveQtyError");
        errEl.style.display = "none";

        document.getElementById("quickMovePrevStock").textContent = `${item.quantity} ${item.unit}`;

        let updated = item.quantity;
        if (moveType === "Stock-In" || moveType === "Stock Return") {
            updated = item.quantity + qty;
        } else if (moveType === "Stock-Out") {
            if (qty > item.quantity) {
                errEl.style.display = "block";
                errEl.textContent = `Cannot issue ${qty} ${item.unit}. Only ${item.quantity} available in stock!`;
            }
            updated = Math.max(0, item.quantity - qty);
        }

        document.getElementById("quickMoveNewStock").textContent = `${updated} ${item.unit}`;
    }

    function openStockMovementModal(stockId = null, moveType = "Stock-In") {
        const stock = StorageService.getStock();
        if (stock.length === 0) {
            UIManager.showToast("No stock items available. Please create a stock item first.", "warning");
            return;
        }

        const targetItem = stockId ? StorageService.getStockById(stockId) : stock[0];
        if (!targetItem) return;

        const modal = document.getElementById("stockMovementModal");
        document.getElementById("quickMoveForm").reset();
        document.getElementById("quickMoveQtyError").style.display = "none";

        // Setup dropdown options
        const itemSelect = document.getElementById("quickMoveItemSelect");
        if (itemSelect) {
            itemSelect.innerHTML = "";
            stock.forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = `${s.id} – ${s.name} (${s.quantity} ${s.unit})`;
                itemSelect.appendChild(opt);
            });
            itemSelect.value = targetItem.id;
        }

        // Show/Hide dropdown vs static header depending on context
        const selectGroup = document.getElementById("quickMoveSelectGroup");
        const staticGroup = document.getElementById("quickMoveStaticGroup");

        if (stockId) {
            // Clicked from specific item row
            if (selectGroup) selectGroup.style.display = "none";
            if (staticGroup) staticGroup.style.display = "block";
        } else {
            // Clicked from top bar / general dashboard button
            if (selectGroup) selectGroup.style.display = "block";
            if (staticGroup) staticGroup.style.display = "none";
        }

        document.getElementById("quickMoveStockItemId").value = targetItem.id;
        document.getElementById("quickMoveItemName").textContent = targetItem.name;
        document.getElementById("quickMoveItemMeta").textContent = `ID: ${targetItem.id} | Available Stock: ${targetItem.quantity} ${targetItem.unit} | Location: ${targetItem.location}`;

        document.getElementById("quickMoveType").value = moveType;
        document.getElementById("quickMoveQty").value = "1";
        document.getElementById("quickMoveParty").value = targetItem.supplier || "";

        updateMovementPreview();
        modal.classList.add("active");
    }

    function closeStockMovementModal() {
        document.getElementById("stockMovementModal")?.classList.remove("active");
    }


    // =========================================================================
    // 5E. STOCK TRANSACTION LEDGER
    // =========================================================================
    function setupTransactions() {
        const searchInput = document.getElementById("txSearchInput");
        const clearBtn = document.getElementById("txClearSearchBtn");
        const typeSelect = document.getElementById("txFilterType");
        const itemSelect = document.getElementById("txFilterItem");
        const resetBtn = document.getElementById("txFilterResetBtn");

        searchInput?.addEventListener("input", function () {
            txFilters.search = this.value.trim().toLowerCase();
            renderTransactions();
        });

        clearBtn?.addEventListener("click", () => {
            searchInput.value = "";
            txFilters.search = "";
            renderTransactions();
        });

        typeSelect?.addEventListener("change", function () { txFilters.type = this.value; renderTransactions(); });
        itemSelect?.addEventListener("change", function () { txFilters.item = this.value; renderTransactions(); });

        resetBtn?.addEventListener("click", () => {
            searchInput.value = "";
            typeSelect.value = "all";
            itemSelect.value = "all";
            txFilters = { search: "", type: "all", item: "all" };
            renderTransactions();
        });

        document.getElementById("txExportBtn")?.addEventListener("click", exportTransactionsCSV);

        // Segmented Tabs: Stock-In, Stock-Out, Stock Return
        const tabBtnIn = document.getElementById("tabBtnStockIn");
        const tabBtnOut = document.getElementById("tabBtnStockOut");
        const tabBtnReturn = document.getElementById("tabBtnStockReturn");
        const panelIn = document.getElementById("panelStockIn");
        const panelOut = document.getElementById("panelStockOut");
        const panelReturn = document.getElementById("panelStockReturn");

        function switchTxTab(activeBtn, activePanel) {
            [tabBtnIn, tabBtnOut, tabBtnReturn].forEach(b => b?.classList.remove("active"));
            [panelIn, panelOut, panelReturn].forEach(p => p?.classList.remove("active"));
            activeBtn?.classList.add("active");
            activePanel?.classList.add("active");
        }

        tabBtnIn?.addEventListener("click", () => switchTxTab(tabBtnIn, panelIn));
        tabBtnOut?.addEventListener("click", () => switchTxTab(tabBtnOut, panelOut));
        tabBtnReturn?.addEventListener("click", () => switchTxTab(tabBtnReturn, panelReturn));

        // Date Defaults
        const todayStr = new Date().toISOString().split("T")[0];
        const inDate = document.getElementById("inDate");
        const outDate = document.getElementById("outDate");
        const retDate = document.getElementById("returnDate");
        if (inDate) inDate.value = todayStr;
        if (outDate) outDate.value = todayStr;
        if (retDate) retDate.value = todayStr;

        // Stock-In Form Preview & Submit
        const inSelect = document.getElementById("inStockItemSelect");
        const inQty = document.getElementById("inQuantity");
        function updateInPreview() {
            const item = StorageService.getStockById(inSelect?.value);
            const q = parseInt(inQty?.value, 10) || 0;
            const prevEl = document.getElementById("inPrevStockDisplay");
            const newEl = document.getElementById("inNewStockDisplay");
            if (!item) {
                if (prevEl) prevEl.textContent = "--";
                if (newEl) newEl.textContent = "--";
                return;
            }
            if (prevEl) prevEl.textContent = `${item.quantity} ${item.unit}`;
            if (newEl) newEl.textContent = `${item.quantity + q} ${item.unit}`;
        }
        inSelect?.addEventListener("change", function () {
            const item = StorageService.getStockById(this.value);
            const sup = document.getElementById("inSupplier");
            if (item && sup && !sup.value) sup.value = item.supplier || "";
            updateInPreview();
        });
        inQty?.addEventListener("input", updateInPreview);

        document.getElementById("formStockIn")?.addEventListener("submit", async function (e) {
            e.preventDefault();
            const stockId = inSelect?.value;
            const q = parseInt(inQty?.value, 10);
            const sup = document.getElementById("inSupplier")?.value.trim() || "";
            const ref = document.getElementById("inReference")?.value.trim() || "";
            const notes = document.getElementById("inNotes")?.value.trim() || "";
            if (!stockId) {
                UIManager.showToast("Please select a consumable stock item.", "error");
                return;
            }
            const refStr = [sup, ref].filter(Boolean).join(" • ");
            try {
                const res = await StorageService.performStockMovement(stockId, "Stock-In", q, refStr, notes);
                refreshAllViews();
                this.reset();
                if (inDate) inDate.value = todayStr;
                updateInPreview();
                UIManager.showToast(`Stock-In completed: +${q} ${res.item.unit} added to ${res.item.name}.`, "success");
            } catch (err) {
                UIManager.showToast(err.message, "error");
            }
        });

        // Stock-Out Form Preview & Submit
        const outSelect = document.getElementById("outStockItemSelect");
        const outQty = document.getElementById("outQuantity");
        const outErr = document.getElementById("outQuantityError");
        function updateOutPreview() {
            const item = StorageService.getStockById(outSelect?.value);
            const q = parseInt(outQty?.value, 10) || 0;
            const prevEl = document.getElementById("outPrevStockDisplay");
            const newEl = document.getElementById("outNewStockDisplay");
            if (outErr) outErr.style.display = "none";
            if (!item) {
                if (prevEl) prevEl.textContent = "--";
                if (newEl) newEl.textContent = "--";
                return;
            }
            if (prevEl) prevEl.textContent = `${item.quantity} ${item.unit}`;
            if (q > item.quantity) {
                if (outErr) {
                    outErr.style.display = "block";
                    outErr.textContent = `Cannot issue ${q} ${item.unit}. Only ${item.quantity} available in stock!`;
                }
            }
            if (newEl) newEl.textContent = `${Math.max(0, item.quantity - q)} ${item.unit}`;
        }
        outSelect?.addEventListener("change", updateOutPreview);
        outQty?.addEventListener("input", updateOutPreview);

        document.getElementById("formStockOut")?.addEventListener("submit", async function (e) {
            e.preventDefault();
            const stockId = outSelect?.value;
            const q = parseInt(outQty?.value, 10);
            const rec = document.getElementById("outRecipient")?.value.trim() || "";
            const purp = document.getElementById("outPurpose")?.value.trim() || "";
            const ref = document.getElementById("outReference")?.value.trim() || "";
            const notes = document.getElementById("outNotes")?.value.trim() || "";
            if (!stockId) {
                UIManager.showToast("Please select a consumable stock item.", "error");
                return;
            }
            const refStr = [rec, purp, ref].filter(Boolean).join(" • ");
            try {
                const res = await StorageService.performStockMovement(stockId, "Stock-Out", q, refStr, notes);
                refreshAllViews();
                this.reset();
                if (outDate) outDate.value = todayStr;
                updateOutPreview();
                UIManager.showToast(`Stock-Out confirmed: -${q} ${res.item.unit} issued for ${res.item.name}.`, "success");
            } catch (err) {
                if (outErr) {
                    outErr.style.display = "block";
                    outErr.textContent = err.message;
                }
                UIManager.showToast(err.message, "error");
            }
        });

        // Stock Return Form Preview & Submit
        const retSelect = document.getElementById("returnStockItemSelect");
        const retQty = document.getElementById("returnQuantity");
        function updateReturnPreview() {
            const item = StorageService.getStockById(retSelect?.value);
            const q = parseInt(retQty?.value, 10) || 0;
            const prevEl = document.getElementById("returnPrevStockDisplay");
            const newEl = document.getElementById("returnNewStockDisplay");
            if (!item) {
                if (prevEl) prevEl.textContent = "--";
                if (newEl) newEl.textContent = "--";
                return;
            }
            if (prevEl) prevEl.textContent = `${item.quantity} ${item.unit}`;
            if (newEl) newEl.textContent = `${item.quantity + q} ${item.unit}`;
        }
        retSelect?.addEventListener("change", updateReturnPreview);
        retQty?.addEventListener("input", updateReturnPreview);

        document.getElementById("formStockReturn")?.addEventListener("submit", async function (e) {
            e.preventDefault();
            const stockId = retSelect?.value;
            const q = parseInt(retQty?.value, 10);
            const by = document.getElementById("returnBy")?.value.trim() || "";
            const ref = document.getElementById("returnReference")?.value.trim() || "";
            const notes = document.getElementById("returnNotes")?.value.trim() || "";
            if (!stockId) {
                UIManager.showToast("Please select a consumable stock item to return.", "error");
                return;
            }
            const refStr = [by, ref].filter(Boolean).join(" • ");
            try {
                const res = await StorageService.performStockMovement(stockId, "Stock Return", q, refStr, notes);
                refreshAllViews();
                this.reset();
                if (retDate) retDate.value = todayStr;
                updateReturnPreview();
                UIManager.showToast(`Stock Return processed: +${q} ${res.item.unit} returned to ${res.item.name}.`, "success");
            } catch (err) {
                UIManager.showToast(err.message, "error");
            }
        });
    }

    function renderTransactions() {
        const txns = StorageService.getStockTransactions();
        const stock = StorageService.getStock();

        // Populate items in the 3 in-page forms (Stock-In, Stock-Out, Stock Return)
        const inSelect = document.getElementById("inStockItemSelect");
        const outSelect = document.getElementById("outStockItemSelect");
        const retSelect = document.getElementById("returnStockItemSelect");

        [
            { el: inSelect, defaultText: "Select consumable item..." },
            { el: outSelect, defaultText: "Select consumable item..." },
            { el: retSelect, defaultText: "Select consumable item to return..." }
        ].forEach(({ el, defaultText }) => {
            if (el) {
                const cur = el.value;
                el.innerHTML = `<option value="">${defaultText}</option>`;
                stock.forEach(s => {
                    const opt = document.createElement("option");
                    opt.value = s.id;
                    opt.textContent = `${s.id} – ${s.name} (${s.quantity} ${s.unit} in stock)`;
                    el.appendChild(opt);
                });
                el.value = cur;
            }
        });

        // Populate items in filter
        const itemSelect = document.getElementById("txFilterItem");
        if (itemSelect) {
            const current = itemSelect.value;
            itemSelect.innerHTML = `<option value="all">All Stock Items</option>`;
            stock.forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = `${s.id} – ${s.name}`;
                itemSelect.appendChild(opt);
            });
            itemSelect.value = current || "all";
        }

        let filtered = txns.filter(t => {
            if (txFilters.search) {
                const q = txFilters.search;
                const mId = (t.id || "").toLowerCase().includes(q);
                const mName = (t.stockName || "").toLowerCase().includes(q);
                const mStockId = (t.stockId || "").toLowerCase().includes(q);
                const mRef = (t.reference || "").toLowerCase().includes(q);
                if (!mId && !mName && !mStockId && !mRef) return false;
            }
            if (txFilters.type !== "all" && t.type !== txFilters.type) return false;
            if (txFilters.item !== "all" && t.stockId.toUpperCase() !== txFilters.item.toUpperCase()) return false;
            return true;
        });

        const tbody = document.getElementById("transactionsTableBody");
        const emptyState = document.getElementById("transactionsEmptyState");
        tbody.innerHTML = "";

        if (filtered.length === 0) {
            tbody.parentElement.style.display = "none";
            emptyState.style.display = "block";
        } else {
            tbody.parentElement.style.display = "";
            emptyState.style.display = "none";

            filtered.forEach(t => {
                const tr = document.createElement("tr");
                const typeClass = t.type === "Stock-In" ? "positive" : t.type === "Stock-Out" ? "warning" : "primary";

                tr.innerHTML = `
                    <td><strong>${escapeHtml(t.id)}</strong></td>
                    <td>${formatDateTime(t.timestamp)}</td>
                    <td><span class="asset-id-pill stock-id-pill" onclick="App.openPassportModal('${t.stockId}', 'stock')">${escapeHtml(t.stockId)}</span> <strong>${escapeHtml(t.stockName)}</strong></td>
                    <td><span class="badge ${typeClass}">${escapeHtml(t.type)}</span></td>
                    <td>${t.type === "Stock-Out" ? "-" : "+"}${t.quantity}</td>
                    <td><strong>${t.newQty}</strong> <small class="text-muted">(was ${t.previousQty})</small></td>
                    <td>${escapeHtml(t.reference || "–")}</td>
                    <td><span style="font-family: monospace;">${escapeHtml(t.id)}</span></td>
                    <td>${escapeHtml(t.notes || "–")}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    function exportTransactionsCSV() {
        const txns = StorageService.getStockTransactions();
        if (txns.length === 0) {
            UIManager.showToast("No transactions to export.", "warning");
            return;
        }

        const headers = ["Txn ID", "Timestamp", "Stock ID", "Stock Name", "Type", "Quantity", "Previous Qty", "New Qty", "Reference", "Notes"];
        const rows = txns.map(t => [
            `"${t.id}"`,
            `"${t.timestamp}"`,
            `"${t.stockId}"`,
            `"${(t.stockName || "").replace(/"/g, '""')}"`,
            `"${t.type}"`,
            t.quantity,
            t.previousQty,
            t.newQty,
            `"${(t.reference || "").replace(/"/g, '""')}"`,
            `"${(t.notes || "").replace(/"/g, '""')}"`
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `TrackQR_StockTransactions_${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
    }


    // =========================================================================
    // 5F. MAINTENANCE MODULE
    // =========================================================================
    function setupMaintenance() {
        const searchInput = document.getElementById("maintenanceSearchInput");
        const statusSelect = document.getElementById("filterMaintStatus");
        const typeSelect = document.getElementById("filterMaintType");

        searchInput?.addEventListener("input", function () {
            maintFilters.search = this.value.trim().toLowerCase();
            renderMaintenance();
        });

        statusSelect?.addEventListener("change", function () {
            maintFilters.status = this.value;
            renderMaintenance();
        });

        typeSelect?.addEventListener("change", function () {
            maintFilters.type = this.value;
            renderMaintenance();
        });

        document.getElementById("maintenanceAddBtn")?.addEventListener("click", () => openMaintenanceModal());
        document.getElementById("maintenanceEmptyAddBtn")?.addEventListener("click", () => openMaintenanceModal());

        setupMaintenanceModal();
    }

    function renderMaintenance() {
        const maint = StorageService.getMaintenance();
        const devices = StorageService.getDevices();

        let filtered = maint.filter(m => {
            if (maintFilters.search) {
                const q = maintFilters.search;
                const mId = (m.id || "").toLowerCase().includes(q);
                const mDevId = (m.deviceId || "").toLowerCase().includes(q);
                const mTitle = (m.title || "").toLowerCase().includes(q);
                const mTech = (m.technician || "").toLowerCase().includes(q);
                if (!mId && !mDevId && !mTitle && !mTech) return false;
            }
            if (maintFilters.status !== "all" && m.status !== maintFilters.status) return false;
            if (maintFilters.type !== "all" && m.type !== maintFilters.type) return false;
            return true;
        });

        const tbody = document.getElementById("maintenanceTableBody");
        const emptyState = document.getElementById("maintenanceEmptyState");
        tbody.innerHTML = "";

        if (filtered.length === 0) {
            tbody.parentElement.style.display = "none";
            emptyState.style.display = "block";
        } else {
            tbody.parentElement.style.display = "";
            emptyState.style.display = "none";

            filtered.forEach(m => {
                const dev = devices.find(d => d.id.toUpperCase() === m.deviceId.toUpperCase());
                const tr = document.createElement("tr");
                const statusBadge = `<span class="badge ${m.status === "Completed" ? "available" : "maintenance"}">${escapeHtml(m.status)}</span>`;

                tr.innerHTML = `
                    <td><strong>${escapeHtml(m.id)}</strong></td>
                    <td>
                        <span class="asset-id-pill" onclick="App.openPassportModal('${m.deviceId}', 'device')">${escapeHtml(m.deviceId)}</span>
                        <small style="display: block; color: var(--text-muted);">${escapeHtml(dev ? dev.name : "Device")}</small>
                    </td>
                    <td><strong>${escapeHtml(m.title)}</strong><br><small class="text-muted">${escapeHtml(m.technician || "Internal")}</small></td>
                    <td><span class="badge condition-badge">${escapeHtml(m.type)}</span></td>
                    <td>${formatDate(m.scheduledDate)}</td>
                    <td>${formatCurrency(m.cost)}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        ${m.status !== "Completed" ? `<button class="btn btn-sm btn-outline-success" onclick="App.markMaintenanceComplete('${m.id}')" title="Mark Done">Complete</button>` : ""}
                        <button class="btn btn-sm btn-secondary" onclick="App.openEditMaintenanceModal('${m.id}')" title="Edit">
                            <svg class="icon-inline"><use href="#icon-edit"/></svg>
                        </button>
                        <button class="btn btn-sm btn-danger-ghost" onclick="App.deleteMaintenancePrompt('${m.id}')" title="Delete">
                            <svg class="icon-inline"><use href="#icon-trash"/></svg>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    function setupMaintenanceModal() {
        const modal = document.getElementById("maintenanceModal");
        const form = document.getElementById("maintenanceModalForm");
        const closeBtn = document.getElementById("closeMaintenanceModalBtn");
        const cancelBtn = document.getElementById("cancelMaintenanceModalBtn");

        closeBtn?.addEventListener("click", closeMaintenanceModal);
        cancelBtn?.addEventListener("click", closeMaintenanceModal);

        form?.addEventListener("submit", async function (e) {
            e.preventDefault();

            const mode = document.getElementById("maintenanceFormMode").value;
            const id = document.getElementById("maintenanceFormId").value;
            const deviceId = document.getElementById("inputMaintDevice").value;
            const title = document.getElementById("inputMaintTitle").value.trim();
            const type = document.getElementById("inputMaintType").value;
            const status = document.getElementById("inputMaintStatus").value;
            const scheduledDate = document.getElementById("inputMaintScheduledDate").value;
            const completedDate = document.getElementById("inputMaintCompletedDate").value;
            const cost = parseFloat(document.getElementById("inputMaintCost").value) || 0;
            const technician = document.getElementById("inputMaintTechnician").value.trim();
            const notes = document.getElementById("inputMaintNotes").value.trim();

            if (!deviceId || !title || !scheduledDate) {
                UIManager.showToast("Please fill in required fields marked with *", "error");
                return;
            }

            const ticketPayload = {
                deviceId,
                title,
                type,
                status,
                scheduledDate,
                completedDate,
                cost,
                technician,
                notes
            };

            try {
                await StorageService.saveMaintenance(ticketPayload, mode === "edit", id);
                closeMaintenanceModal();
                refreshAllViews();
                UIManager.showToast(`Maintenance ticket saved.`, "success");
            } catch (err) {
                UIManager.showToast(`Save failed: ${err.message}`, "error");
            }
        });
    }

    function openMaintenanceModal(preselectedDeviceId = null) {
        const devices = StorageService.getDevices();
        if (devices.length === 0) {
            UIManager.showToast("No registered devices. Add a device before scheduling maintenance.", "warning");
            return;
        }

        const modal = document.getElementById("maintenanceModal");
        const form = document.getElementById("maintenanceModalForm");
        form.reset();

        document.getElementById("maintenanceModalTitle").textContent = "Schedule Device Maintenance";
        document.getElementById("maintenanceFormMode").value = "add";
        document.getElementById("maintenanceFormId").value = "";

        const devSelect = document.getElementById("inputMaintDevice");
        devSelect.innerHTML = `<option value="">Select Device to Service</option>`;
        devices.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = `${d.id} – ${d.name} (${d.status})`;
            devSelect.appendChild(opt);
        });

        if (preselectedDeviceId) {
            devSelect.value = preselectedDeviceId.toUpperCase();
        }

        document.getElementById("inputMaintScheduledDate").value = new Date().toISOString().split("T")[0];
        document.getElementById("inputMaintStatus").value = "Scheduled";
        modal.classList.add("active");
    }

    function openEditMaintenanceModal(id) {
        const m = StorageService.getMaintenance().find(item => item.id === id);
        if (!m) return;

        openMaintenanceModal(m.deviceId);
        document.getElementById("maintenanceModalTitle").textContent = `Edit Maintenance Ticket (${m.id})`;
        document.getElementById("maintenanceFormMode").value = "edit";
        document.getElementById("maintenanceFormId").value = m.id;

        document.getElementById("inputMaintDevice").value = m.deviceId;
        document.getElementById("inputMaintTitle").value = m.title;
        document.getElementById("inputMaintType").value = m.type;
        document.getElementById("inputMaintStatus").value = m.status;
        document.getElementById("inputMaintScheduledDate").value = m.scheduledDate;
        document.getElementById("inputMaintCompletedDate").value = m.completedDate || "";
        document.getElementById("inputMaintCost").value = m.cost || "";
        document.getElementById("inputMaintTechnician").value = m.technician || "";
        document.getElementById("inputMaintNotes").value = m.notes || "";
    }

    async function markMaintenanceComplete(id) {
        const m = StorageService.getMaintenance().find(item => item.id === id);
        if (!m) return;

        m.status = "Completed";
        m.completedDate = new Date().toISOString().split("T")[0];

        try {
            await StorageService.saveMaintenance(m, true, id);
            refreshAllViews();
            UIManager.showToast(`Maintenance ticket ${id} marked Completed!`, "success");
        } catch (e) {
            UIManager.showToast(`Update failed: ${e.message}`, "error");
        }
    }

    function deleteMaintenancePrompt(id) {
        UIManager.confirmAction(
            `Delete maintenance ticket ${id}?`,
            async () => {
                try {
                    await StorageService.deleteMaintenance(id);
                    refreshAllViews();
                    UIManager.showToast(`Ticket ${id} removed.`, "info");
                } catch (e) {
                    UIManager.showToast(`Delete failed: ${e.message}`, "error");
                }
            },
            "Delete Maintenance Ticket"
        );
    }

    function closeMaintenanceModal() {
        document.getElementById("maintenanceModal")?.classList.remove("active");
    }


    // =========================================================================
    // 5G. UNIFIED QR PASSPORT & TAG MODAL
    // =========================================================================
    let currentPassportEntity = null;

    function setupPassportModal() {
        document.getElementById("closePassportModalBtn")?.addEventListener("click", closePassportModal);
        document.getElementById("passportDownloadPngBtn")?.addEventListener("click", () => {
            if (currentPassportEntity) {
                QrController.downloadQrPng(currentPassportEntity.id, currentPassportEntity.name, currentPassportEntity._type);
            }
        });
        document.getElementById("passportPrintTagBtn")?.addEventListener("click", () => QrController.printTag());
        document.getElementById("passportEditBtn")?.addEventListener("click", () => {
            if (!currentPassportEntity) return;
            const id = currentPassportEntity.id;
            const type = currentPassportEntity._type;
            closePassportModal();
            if (type === 'device') openEditDeviceModal(id);
            else openEditStockModal(id);
        });
        document.getElementById("passportDeleteBtn")?.addEventListener("click", () => {
            if (!currentPassportEntity) return;
            const id = currentPassportEntity.id;
            const type = currentPassportEntity._type;
            closePassportModal();
            if (type === 'device') deleteDevicePrompt(id);
            else deleteStockPrompt(id);
        });
    }

    function openPassportModal(id, type = 'device') {
        const settings = StorageService.getSettings();
        let entity = null;

        if (type === 'device') {
            entity = StorageService.getDeviceById(id);
        } else {
            entity = StorageService.getStockById(id);
        }

        if (!entity) {
            UIManager.showToast(`Item "${id}" not found.`, "error");
            return;
        }

        entity._type = type;
        currentPassportEntity = entity;

        const modal = document.getElementById("qrPassportModal");

        // 1. Tag Card (Left)
        document.getElementById("passportOrgName").textContent = settings.orgName;
        document.getElementById("passportTagTypeBadge").textContent = type === 'device' ? "DEVICE ASSET TAG" : "STOCK ITEM TAG";
        document.getElementById("passportTagId").textContent = entity.id;
        document.getElementById("passportTagName").textContent = entity.name;
        document.getElementById("passportTagCategory").textContent = entity.category;
        document.getElementById("passportTagFooterMeta").textContent = type === 'device' ? `LOC: ${entity.location}` : `BIN: ${entity.location}`;

        // QR Code
        QrController.renderQrCode(document.getElementById("passportQrContainer"), entity.id, 180);

        // 2. Specifications Column (Right)
        document.getElementById("passportNameDisplay").textContent = entity.name;
        document.getElementById("passportCategoryDisplay").textContent = entity.category;

        const statusBadge = document.getElementById("passportStatusBadge");
        if (type === 'device') {
            statusBadge.textContent = entity.status;
            statusBadge.className = `badge ${entity.status.toLowerCase().replace(/\s+/g, "-")}`;
        } else {
            const stockBadgeText = entity.quantity === 0 ? "Out of Stock" : entity.quantity <= entity.minLevel ? "Low Stock" : "In Stock";
            const stockBadgeClass = entity.quantity === 0 ? "out-of-stock" : entity.quantity <= entity.minLevel ? "low-stock" : "in-stock";
            statusBadge.textContent = `${stockBadgeText} (${entity.quantity} ${entity.unit})`;
            statusBadge.className = `badge ${stockBadgeClass}`;
        }

        // Specs Grid Dynamic Items
        const specsGrid = document.getElementById("passportSpecsGrid");
        specsGrid.innerHTML = "";

        if (type === 'device') {
            specsGrid.innerHTML = `
                <div class="meta-item"><label>Asset ID</label><span>${escapeHtml(entity.id)}</span></div>
                <div class="meta-item"><label>Serial Number</label><span>${escapeHtml(entity.serial || "N/A")}</span></div>
                <div class="meta-item"><label>Location</label><span>${escapeHtml(entity.location)}</span></div>
                <div class="meta-item"><label>Assigned To</label><span>${escapeHtml(entity.assignedTo || "Unassigned")}</span></div>
                <div class="meta-item"><label>Condition</label><span>${escapeHtml(entity.condition || "Good")}</span></div>
                <div class="meta-item"><label>Purchase Date</label><span>${formatDate(entity.purchaseDate)}</span></div>
                <div class="meta-item"><label>Cost</label><span>${formatCurrency(entity.cost)}</span></div>
                <div class="meta-item" style="grid-column: 1 / -1;"><label>Notes</label><span>${escapeHtml(entity.notes || "None")}</span></div>
            `;
        } else {
            specsGrid.innerHTML = `
                <div class="meta-item"><label>Stock Item ID</label><span>${escapeHtml(entity.id)}</span></div>
                <div class="meta-item"><label>Available Stock</label><span>${entity.quantity} ${escapeHtml(entity.unit)}</span></div>
                <div class="meta-item"><label>Minimum Level</label><span>${entity.minLevel} ${escapeHtml(entity.unit)}</span></div>
                <div class="meta-item"><label>Storage Location</label><span>${escapeHtml(entity.location)}</span></div>
                <div class="meta-item"><label>Unit Price</label><span>${formatCurrency(entity.unitPrice)}</span></div>
                <div class="meta-item"><label>Inventory Value</label><span>${formatCurrency(entity.quantity * (entity.unitPrice || 0))}</span></div>
                <div class="meta-item"><label>Supplier</label><span>${escapeHtml(entity.supplier || "N/A")}</span></div>
                <div class="meta-item" style="grid-column: 1 / -1;"><label>Notes</label><span>${escapeHtml(entity.notes || "None")}</span></div>
            `;
        }

        // Action Buttons Row
        const addActions = document.getElementById("passportAdditionalActions");
        addActions.innerHTML = "";
        if (type === 'device') {
            addActions.innerHTML = `
                <button class="btn btn-sm btn-secondary" onclick="App.openMaintenanceModal('${entity.id}')">
                    <svg class="icon-inline"><use href="#icon-maintenance"/></svg>
                    <span>Schedule Repair</span>
                </button>
            `;
        } else {
            addActions.innerHTML = `
                <button class="btn btn-sm btn-success" onclick="App.openStockMovementModal('${entity.id}', 'Stock-In')">+ Stock-In</button>
                <button class="btn btn-sm btn-primary" onclick="App.openStockMovementModal('${entity.id}', 'Stock-Out')">- Stock-Out</button>
                <button class="btn btn-sm btn-secondary" onclick="App.openStockMovementModal('${entity.id}', 'Stock Return')">Return ↩</button>
            `;
        }

        modal.classList.add("active");
    }

    function closePassportModal() {
        document.getElementById("qrPassportModal")?.classList.remove("active");
        currentPassportEntity = null;
    }


    // =========================================================================
    // 5H. CATEGORIES & TAXONOMY MODULE
    // =========================================================================
    let currentCatFilter = "all";

    function refreshCategoryDependentControls() {
        // Rebuild filter and form dropdowns from the current in-memory category cache.
        // This prevents stale category options after add/edit/delete operations.
        const deviceSelect = document.getElementById("inputDeviceCategory");
        if (deviceSelect) {
            const current = deviceSelect.value;
            deviceSelect.innerHTML = '<option value="">Select Category</option>';
            StorageService.getDeviceCategories().forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.name;
                opt.textContent = `${c.name} (${c.prefix})`;
                deviceSelect.appendChild(opt);
            });
            if ([...deviceSelect.options].some(o => o.value === current)) deviceSelect.value = current;
        }

        const stockSelect = document.getElementById("inputStockCategory");
        if (stockSelect) {
            const current = stockSelect.value;
            stockSelect.innerHTML = '<option value="">Select Category</option>';
            StorageService.getStockCategories().forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.name;
                opt.textContent = `${c.name} (${c.prefix})`;
                stockSelect.appendChild(opt);
            });
            if ([...stockSelect.options].some(o => o.value === current)) stockSelect.value = current;
        }
    }

    function setupCategories() {
        document.getElementById("categoryAddBtn")?.addEventListener("click", () => openAddCategoryModal());
        document.getElementById("catFilterAll")?.addEventListener("click", function () {
            currentCatFilter = "all";
            setActiveCatFilterBtn(this);
            renderCategories();
        });
        document.getElementById("catFilterDevices")?.addEventListener("click", function () {
            currentCatFilter = "device";
            setActiveCatFilterBtn(this);
            renderCategories();
        });
        document.getElementById("catFilterStock")?.addEventListener("click", function () {
            currentCatFilter = "stock";
            setActiveCatFilterBtn(this);
            renderCategories();
        });

        setupCategoryModal();
    }

    function setActiveCatFilterBtn(btn) {
        document.querySelectorAll("#tab-categories .filter-controls-row .btn").forEach(b => {
            b.className = "btn btn-sm btn-secondary";
        });
        btn.className = "btn btn-sm btn-primary";
    }

    function renderCategories() {
        const categories = StorageService.getCategories();
        const devices = StorageService.getDevices();
        const stock = StorageService.getStock();

        const grid = document.getElementById("categoriesGrid");
        grid.innerHTML = "";

        const filtered = categories.filter(c => {
            if (currentCatFilter === "all") return true;
            return c.type === currentCatFilter;
        });

        if (filtered.length === 0) {
            grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><p>No categories found in this section.</p></div>`;
            return;
        }

        filtered.forEach(cat => {
            const card = document.createElement("div");
            card.className = "category-card";

            let count = 0;
            if (cat.type === "device") {
                count = devices.filter(d => d.category === cat.name).length;
            } else {
                count = stock.filter(s => s.category === cat.name).length;
            }

            const typeLabel = cat.type === "device" ? "Device Category" : "Stock Category";
            const badgeClass = cat.type === "device" ? "primary" : "in-stock";

            card.innerHTML = `
                <div class="category-card-header">
                    <span class="badge ${badgeClass}">${typeLabel}</span>
                    <span class="category-prefix-badge">${escapeHtml(cat.prefix)}</span>
                </div>
                <h3>${escapeHtml(cat.name)}</h3>
                <p class="category-desc">${escapeHtml(cat.desc || "Standard inventory taxonomy.")}</p>
                <div class="category-card-footer">
                    <span class="category-count">${count} ${cat.type === "device" ? "devices" : "items"}</span>
                    <div class="action-buttons-sm">
                        <button class="btn btn-sm btn-secondary" onclick="App.openEditCategoryModal('${cat.id}')" title="Edit Category">
                            <svg class="icon-inline"><use href="#icon-edit"/></svg>
                        </button>
                        <button class="btn btn-sm btn-danger-ghost" onclick="App.deleteCategoryPrompt('${cat.id}')" title="Delete Category">
                            <svg class="icon-inline"><use href="#icon-trash"/></svg>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    function setupCategoryModal() {
        const modal = document.getElementById("categoryModal");
        const form = document.getElementById("categoryModalForm");
        const closeBtn = document.getElementById("closeCategoryModalBtn");
        const cancelBtn = document.getElementById("cancelCategoryModalBtn");

        closeBtn?.addEventListener("click", closeCategoryModal);
        cancelBtn?.addEventListener("click", closeCategoryModal);

        form?.addEventListener("submit", async function (e) {
            e.preventDefault();

            const mode = document.getElementById("categoryFormMode").value;
            const id = document.getElementById("categoryFormOriginalId").value;
            const type = document.getElementById("inputCategoryType").value;
            const name = document.getElementById("inputCategoryName").value.trim();
            const prefix = document.getElementById("inputCategoryPrefix").value.trim().toUpperCase();
            const desc = document.getElementById("inputCategoryDesc").value.trim();

            document.getElementById("errorCategoryName").textContent = "";
            document.getElementById("errorCategoryPrefix").textContent = "";

            if (!name || !prefix) {
                UIManager.showToast("Category name and prefix are required.", "error");
                return;
            }

            try {
                await StorageService.saveCategory({ type, name, prefix, desc }, mode === "edit", id);
                closeCategoryModal();
                refreshAllViews();
                refreshCategoryDependentControls();
                UIManager.showToast(`Category "${name}" (${prefix}) saved.`, "success");
            } catch (err) {
                document.getElementById("errorCategoryPrefix").textContent = err.message;
                UIManager.showToast(err.message, "error");
            }
        });
    }

    function openAddCategoryModal() {
        const modal = document.getElementById("categoryModal");
        const form = document.getElementById("categoryModalForm");
        form.reset();

        document.getElementById("categoryModalTitle").textContent = "Add New Category";
        document.getElementById("categoryFormMode").value = "add";
        document.getElementById("categoryFormOriginalId").value = "";
        document.getElementById("inputCategoryType").disabled = false;
        modal.classList.add("active");
    }

    function openEditCategoryModal(id) {
        const cat = StorageService.getCategories().find(c => c.id === id);
        if (!cat) return;

        openAddCategoryModal();
        document.getElementById("categoryModalTitle").textContent = `Edit Category (${cat.name})`;
        document.getElementById("categoryFormMode").value = "edit";
        document.getElementById("categoryFormOriginalId").value = cat.id;

        document.getElementById("inputCategoryType").value = cat.type;
        document.getElementById("inputCategoryType").disabled = true;
        document.getElementById("inputCategoryName").value = cat.name;
        document.getElementById("inputCategoryPrefix").value = cat.prefix;
        document.getElementById("inputCategoryDesc").value = cat.desc || "";
    }

    function closeCategoryModal() {
        document.getElementById("categoryModal")?.classList.remove("active");
    }

    function deleteCategoryPrompt(id) {
        const cat = StorageService.getCategories().find(c => c.id === id);
        if (!cat) return;

        UIManager.confirmAction(
            `Delete category "${cat.name}" (${cat.prefix})? This is only allowed if no items are currently cataloged under it.`,
            async () => {
                try {
                    await StorageService.deleteCategory(id);
                    refreshAllViews();
                    refreshCategoryDependentControls();
                    UIManager.showToast(`Category ${cat.name} deleted.`, "info");
                } catch (e) {
                    UIManager.showToast(`Delete failed: ${e.message}`, "error");
                }
            },
            "Delete Category"
        );
    }


    // =========================================================================
    // 5I. ACTIVITY AUDIT LOGS
    // =========================================================================
    function setupActivity() {
        const searchInput = document.getElementById("activitySearchInput");
        const typeSelect = document.getElementById("filterActivityType");

        searchInput?.addEventListener("input", function () {
            activityFilters.search = this.value.trim().toLowerCase();
            renderActivity();
        });

        typeSelect?.addEventListener("change", function () {
            activityFilters.type = this.value;
            renderActivity();
        });

        document.getElementById("activityExportBtn")?.addEventListener("click", exportActivityCSV);
        document.getElementById("activityClearBtn")?.addEventListener("click", () => {
            UIManager.confirmAction(
                "Are you sure you want to clear all activity logs?",
                async () => {
                    await StorageService.clearLogs();
                    renderActivity();
                    UIManager.showToast("Activity logs cleared.", "info");
                },
                "Clear Activity Logs"
            );
        });
    }

    function createActivityItemNode(log) {
        const item = document.createElement("div");
        item.className = "activity-item";

        const iconMap = {
            Device: "#icon-devices",
            Stock: "#icon-stock",
            Maintenance: "#icon-maintenance",
            "QR Scanned": "#icon-scanner",
            System: "#icon-settings"
        };
        const icon = iconMap[log.category] || "#icon-dashboard";

        item.innerHTML = `
            <div class="activity-icon-badge">
                <svg class="icon-inline"><use href="${icon}"/></svg>
            </div>
            <div class="activity-content">
                <div class="activity-title">${escapeHtml(log.title)}</div>
                <div class="activity-details">${escapeHtml(log.details)}</div>
                <small class="activity-time text-muted">${formatDateTime(log.timestamp)} • User: ${escapeHtml(log.user || "Admin")}</small>
            </div>
        `;
        return item;
    }

    function renderActivity() {
        const logs = StorageService.getLogs();
        const list = document.getElementById("fullActivityLogList");
        const emptyState = document.getElementById("activityEmptyState");
        list.innerHTML = "";

        const filtered = logs.filter(l => {
            if (activityFilters.search) {
                const q = activityFilters.search;
                const mTitle = (l.title || "").toLowerCase().includes(q);
                const mDetails = (l.details || "").toLowerCase().includes(q);
                if (!mTitle && !mDetails) return false;
            }
            if (activityFilters.type !== "all" && l.type !== activityFilters.type && l.category !== activityFilters.type) return false;
            return true;
        });

        if (filtered.length === 0) {
            emptyState.style.display = "block";
        } else {
            emptyState.style.display = "none";
            filtered.forEach(l => list.appendChild(createActivityItemNode(l)));
        }
    }

    function exportActivityCSV() {
        const logs = StorageService.getLogs();
        if (logs.length === 0) {
            UIManager.showToast("No activity logs to export.", "warning");
            return;
        }

        const headers = ["Timestamp", "Category", "Action", "Details", "User"];
        const rows = logs.map(l => [
            `"${l.timestamp}"`,
            `"${l.category}"`,
            `"${l.title}"`,
            `"${(l.details || "").replace(/"/g, '""')}"`,
            `"${l.user || "Admin"}"`
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `TrackQR_ActivityLogs_${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
    }


    // =========================================================================
    // 5J. SETTINGS & SYSTEM BACKUPS
    // =========================================================================
    function setupSettings() {
        const generalForm = document.getElementById("generalSettingsForm");
        const scannerForm = document.getElementById("scannerSettingsForm");

        generalForm?.addEventListener("submit", async function (e) {
            e.preventDefault();
            const orgName = document.getElementById("settingOrgName").value.trim();
            const currency = document.getElementById("settingCurrency").value;

            try {
                await StorageService.saveSettings({ orgName, currency });
                refreshAllViews();
                UIManager.showToast("Organization details updated and saved to database.", "success");
            } catch (err) {
                UIManager.showToast(`Save failed: ${err.message}`, "error");
            }
        });

        scannerForm?.addEventListener("submit", async function (e) {
            e.preventDefault();
            const soundEnabled = document.getElementById("settingSoundToggle").checked;
            const autoOpenModal = document.getElementById("settingAutoOpenModal").checked;
            const scanCooldown = parseInt(document.getElementById("settingScanCooldown").value, 10);

            try {
                await StorageService.saveSettings({ soundEnabled, autoOpenModal, scanCooldown });
                UIManager.showToast("Scanner parameters updated.", "success");
            } catch (err) {
                UIManager.showToast(`Save failed: ${err.message}`, "error");
            }
        });

        document.getElementById("exportBackupBtn")?.addEventListener("click", async () => {
            try {
                const json = await StorageService.exportDatabaseJSON();
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `TrackQR_Complete_Database_${new Date().toISOString().split("T")[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                UIManager.showToast("Full database backup downloaded.", "success");
            } catch (e) {
                UIManager.showToast(`Export failed: ${e.message}`, "error");
            }
        });

        const importInput = document.getElementById("importBackupInput");
        document.getElementById("importBackupTriggerBtn")?.addEventListener("click", () => importInput.click());

        importInput?.addEventListener("change", function (e) {
            if (!this.files || !this.files[0]) return;
            const file = this.files[0];
            const reader = new FileReader();
            reader.onload = async function (evt) {
                try {
                    await StorageService.importDatabaseJSON(evt.target.result);
                    refreshAllViews();
                    UIManager.showToast("Database restored successfully!", "success");
                } catch (err) {
                    UIManager.showToast(`Restore failed: ${err.message}`, "error");
                }
            };
            reader.readAsText(file);
        });

        document.getElementById("resetDemoDataBtn")?.addEventListener("click", () => {
            UIManager.confirmAction(
                "Reset all data back to the default demonstration dataset? Any custom assets and logs will be replaced with fresh demo records.",
                async () => {
                    try {
                        const res = await fetch('/api/backup/export');
                        window.location.reload();
                    } catch (e) {}
                },
                "Reset to Demo Data"
            );
        });

        document.getElementById("wipeAllDataBtn")?.addEventListener("click", () => {
            UIManager.confirmAction(
                "Are you sure you want to PERMANENTLY ERASE all devices, stock items, transactions, and logs? This cannot be undone.",
                async () => {
                    try {
                        await StorageService.importDatabaseJSON(JSON.stringify({
                            devices: [],
                            stock: [],
                            stockTransactions: [],
                            maintenance: [],
                            logs: []
                        }));
                        refreshAllViews();
                        UIManager.showToast("Database wiped.", "warning");
                    } catch (e) {
                        UIManager.showToast(`Wipe failed: ${e.message}`, "error");
                    }
                },
                "Wipe Entire Database"
            );
        });
    }

    function renderSettings() {
        const s = StorageService.getSettings();
        document.getElementById("settingOrgName").value = s.orgName || "";
        document.getElementById("settingCurrency").value = s.currency || "$";
        document.getElementById("settingSoundToggle").checked = !!s.soundEnabled;
        document.getElementById("settingAutoOpenModal").checked = !!s.autoOpenModal;
        document.getElementById("settingScanCooldown").value = String(s.scanCooldown || 2500);
    }


    // =========================================================================
    // 5K. QUICK LOOKUP PILLS IN SCANNER VIEW
    // =========================================================================
    function renderSampleLookupTags() {
        const container = document.getElementById("sampleLookupTags");
        if (!container) return;
        container.innerHTML = "";

        const devs = StorageService.getDevices().slice(0, 3);
        devs.forEach(d => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "asset-id-pill";
            btn.textContent = `${d.id} (Dev)`;
            btn.onclick = () => {
                document.getElementById("manualAssetIdInput").value = d.id;
                ScannerController.handleScannedCode(d.id);
            };
            container.appendChild(btn);
        });

        const stock = StorageService.getStock().slice(0, 3);
        stock.forEach(s => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "asset-id-pill stock-id-pill";
            btn.textContent = `${s.id} (Stock)`;
            btn.onclick = () => {
                document.getElementById("manualAssetIdInput").value = s.id;
                ScannerController.handleScannedCode(s.id);
            };
            container.appendChild(btn);
        });
    }

    function refreshAllViews() {
        renderDashboard();
        renderDevices();
        renderStock();
        renderTransactions();
        renderMaintenance();
        renderCategories();
        renderActivity();
        renderSettings();
        renderSampleLookupTags();
    }

    return {
        init,
        switchTab,
        refreshAllViews,
        // Devices
        openAddDeviceModal,
        openAddDeviceModalWithId,
        openEditDeviceModal,
        deleteDevicePrompt,
        // Stock
        openAddStockModal,
        openAddStockModalWithId,
        openEditStockModal,
        deleteStockPrompt,
        openStockMovementModal,
        // Passport
        openPassportModal,
        // Maintenance
        openMaintenanceModal,
        openEditMaintenanceModal,
        markMaintenanceComplete,
        deleteMaintenancePrompt,
        // Categories
        openAddCategoryModal,
        openEditCategoryModal,
        deleteCategoryPrompt
    };
})();


// =============================================================================
// INITIALIZE ON DOM CONTENT LOADED
// =============================================================================
document.addEventListener("DOMContentLoaded", function () {
    App.init();

    const manualForm = document.getElementById("manualLookupForm");
    const manualInput = document.getElementById("manualAssetIdInput");
    manualForm?.addEventListener("submit", function (e) {
        e.preventDefault();
        const id = manualInput.value.trim().toUpperCase();
        if (id) {
            ScannerController.handleScannedCode(id);
        }
    });
});

// Expose to window for inline onclick handlers and debugging
if (typeof window !== "undefined") {
    window.StorageService = StorageService;
    window.UIManager = UIManager;
    window.QrController = QrController;
    window.ScannerController = ScannerController;
    window.App = App;
}
