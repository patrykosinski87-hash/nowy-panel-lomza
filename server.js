const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = 'OMNI_OS_ULTRA_HIDDEN_2024';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    // 1. KADRA (Roles: OWNER, ADMIN, MODERATOR, SUPPORT, DEV)
    db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, last_active DATETIME)`);
    // 2. PLAYER ANALYTICS & SECURITY
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, money INTEGER, level INTEGER, status TEXT, warnings INTEGER, job TEXT, ip_flag TEXT, device_id TEXT)`);
    // 3. SERVER INSTANCES
    db.run(`CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, region TEXT, uptime TEXT, tps REAL, players_count INTEGER, status TEXT)`);
    // 4. GLOBAL AUDIT LOGS
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, action TEXT, details TEXT, category TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    // 5. ECONOMY & SECURITY ALERTS
    db.run(`CREATE TABLE IF NOT EXISTS security_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, threat_level TEXT, details TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // Dane początkowe (Seeding)
    db.run("INSERT OR IGNORE INTO staff (username, password, role) VALUES ('admin', '$2a$10$7R.E.X.E.CUTABLE.HASH', 'OWNER')");
});

// Middleware: RBAC (Role Based Access Control)
const authorize = (roles = []) => (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED_ACCESS' });
    try {
        const decoded = jwt.verify(token, SECRET);
        if (roles.length && !roles.includes(decoded.role)) return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' });
        req.user = decoded;
        next();
    } catch (e) { res.status(401).json({ error: 'SESSION_EXPIRED' }); }
};

// API: Dashboard Stats
app.get('/api/v1/dashboard', authorize(), (req, res) => {
    res.json({
        online: 1240,
        active_servers: 42,
        security_threats: 3,
        revenue_today: 15400,
        cpu_usage: '14.2%',
        exploits_blocked: 124
    });
});

// API: Players
app.get('/api/v1/players', authorize(['OWNER', 'ADMIN', 'MODERATOR']), (req, res) => {
    db.all("SELECT * FROM players", (err, rows) => res.json(rows));
});

// API: Logs
app.get('/api/v1/logs', authorize(['OWNER', 'ADMIN']), (req, res) => {
    db.all("SELECT * FROM logs ORDER BY time DESC LIMIT 50", (err, rows) => res.json(rows));
});

// ... (Endpointy Auth: Login, Register, Logout pozostają podobne jak wcześniej, z obsługą ról)

app.listen(PORT, () => console.log(`🚀 OMNI-OS CORE ONLINE ON PORT ${PORT}`));
