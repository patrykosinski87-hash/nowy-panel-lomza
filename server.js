const express = require('express');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "Omni_Ultra_Secret_Key_2024!";
const ROBLOX_API_KEY = "OMNI_ROBLOX_KEY_2024"; 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./enterprise.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, level INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, player TEXT, type TEXT, reason TEXT, duration TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    // NOWA TABELA: Aktywne bany
    db.run(`CREATE TABLE IF NOT EXISTS active_bans (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, reason TEXT, duration TEXT, admin TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET, (err, user) => { 
        if (err) return res.status(403).json({ success: false }); 
        req.user = user; next(); 
    });
};

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password, roleCode } = req.body;
    const codes = { 'A7K2M8QX': { role: 'Owner', level: 5 }, '9BZ4L2WP': { role: 'Zarząd', level: 4 }, 'X5N8C3RA': { role: 'Admin', level: 3 }, 'M8Y4P1ZX': { role: 'Moderator', level: 2 }, 'T2Q7V9KD': { role: 'Pomocnik', level: 1 } };
    const roleData = codes[roleCode];
    if (!roleData) return res.status(400).json({ success: false, message: "Zły kod zaproszenia!" });
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password, role, level) VALUES (?, ?, ?, ?)", [username, hashedPassword, roleData.role, roleData.level], function(err) {
            if (err) return res.status(400).json({ success: false, message: "Login zajęty!" });
            res.json({ success: true, message: "Konto utworzone." });
        });
    } catch(err) { res.status(500).json({ success: false }); }
});

app.post('/api/auth/login', (req, res) => {
    db.get("SELECT * FROM users WHERE username = ?", [req.body.username], async (err, user) => {
        if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false, message: "Błędne dane" });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, level: user.level }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, role: user.role, level: user.level } });
    });
});

// --- ZARZĄDZANIE ADMINISTRACJĄ ---
app.get('/api/staff', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false});
    db.all("SELECT id, username, role, level FROM users ORDER BY level DESC", [], (err, rows) => res.json({ success: true, data: rows }));
});
app.post('/api/staff/action', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false});
    db.get("SELECT level FROM users WHERE id = ?", [req.body.targetId], (err, targetUser) => {
        if(!targetUser || req.user.level <= targetUser.level) return res.status(403).json({success: false, message: "Brak uprawnień do tego konta."});
        db.run("DELETE FROM users WHERE id = ?", [req.body.targetId]);
        res.json({ success: true, message: "Konto usunięte." });
    });
});

// --- ZARZĄDZANIE BANAMI (UNBAN) ---
app.get('/api/bans', authenticate, (req, res) => {
    db.all("SELECT * FROM active_bans ORDER BY date DESC", [], (err, rows) => res.json({ success: true, data: rows }));
});
app.post('/api/bans/unban', authenticate, (req, res) => {
    db.run("DELETE FROM active_bans WHERE username = ?", [req.body.username], (err) => {
        io.emit('system_alert', { type: 'success', message: `${req.user.username} zdjął bana graczowi ${req.body.username}` });
        res.json({ success: true });
    });
});

// --- MOSTEK ROBLOX-API ---
let activeServers = {}; 
let pendingActions = []; 

// 1. Roblox pyta o bana przy wejściu gracza (Zabezpieczenie przed nieautoryzowanym API)
app.get('/api/roblox/check-ban/:username', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    db.get("SELECT * FROM active_bans WHERE username = ?", [req.params.username], (err, row) => {
        if (row) res.json({ banned: true, reason: row.reason, duration: row.duration });
        else res.json({ banned: false });
    });
});

// 2. Synchronizacja serwerów
app.post('/api/roblox/sync', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    activeServers[req.body.jobId] = { players: req.body.players || [], ping: req.body.ping, lastSeen: Date.now() };
    const recentActions = pendingActions.filter(a => Date.now() - a.timestamp < 10000);
    res.json({ actions: recentActions });
});

// 3. Odbieranie akcji z Panelu Web
app.post('/api/servers/action', authenticate, (req, res) => {
    const { type, payload, target, reason, duration } = req.body;
    pendingActions.push({ id: Date.now(), type, payload, target, reason, duration, timestamp: Date.now() });
    
    if(type === 'BAN_PLAYER') {
        db.run("INSERT OR REPLACE INTO active_bans (username, reason, duration, admin) VALUES (?, ?, ?, ?)", [target, reason, duration, req.user.username]);
    }
    
    if(type === 'BAN_PLAYER' || type === 'KICK_PLAYER') {
        db.run("INSERT INTO punishments (admin, player, type, reason, duration) VALUES (?, ?, ?, ?, ?)", [req.user.username, target, type, reason, duration]);
        io.emit('system_alert', { type: type === 'BAN_PLAYER' ? 'error' : 'warning', message: `${req.user.username} wykonał ${type} na ${target}` });
    } else {
        io.emit('system_alert', { type: 'info', message: `Wysłano globalną komendę: ${type}` });
    }
    
    res.json({ success: true });
});

app.get('/api/live-data', authenticate, (req, res) => {
    let exactPlayerCount = 0; let allPlayersList = [];
    Object.keys(activeServers).forEach(jobId => { 
        if(Date.now() - activeServers[jobId].lastSeen > 15000) delete activeServers[jobId]; 
        else { exactPlayerCount += activeServers[jobId].players.length; allPlayersList = allPlayersList.concat(activeServers[jobId].players); }
    });
    res.json({ success: true, servers: activeServers, totalPlayers: exactPlayerCount, playerList: allPlayersList });
});

setInterval(() => {
    let count = 0; Object.values(activeServers).forEach(s => count += s.players.length);
    io.emit('live_stats', { playersOnline: count, tps: 60 });
}, 2000);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`🚀 OMNI-OS Enterprise Server Live na porcie ${PORT}`));
