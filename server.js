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
const ROBLOX_API_KEY = "OMNI_ROBLOX_KEY_2024"; // Zabezpieczenie komunikacji z grą

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./enterprise.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, level INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, roblox_id TEXT, username TEXT, currency INTEGER, exploit_score INTEGER, is_banned BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, player TEXT, type TEXT, reason TEXT)`);
});

const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: "Brak dostępu" });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Sesja wygasła" });
        req.user = user; next();
    });
};

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password, roleCode } = req.body;
    const codes = { 'A7K2M8QX': { role: 'Owner', level: 5 }, '9BZ4L2WP': { role: 'Zarząd', level: 4 }, 'X5N8C3RA': { role: 'Admin', level: 3 }, 'M8Y4P1ZX': { role: 'Moderator', level: 2 } };
    const roleData = codes[roleCode];
    if (!roleData) return res.status(400).json({ success: false, message: "Zły kod zaproszenia!" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users (username, password, role, level) VALUES (?, ?, ?, ?)", [username, hashedPassword, roleData.role, roleData.level], function(err) {
        if (err) return res.status(400).json({ success: false, message: "Login zajęty!" });
        res.json({ success: true, message: "Utworzono konto." });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: "Błędne dane" });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, level: user.level }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, role: user.role, level: user.level } });
    });
});

// --- STAFF MANAGEMENT ---
app.get('/api/staff', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false, message: "Brak uprawnień."});
    db.all("SELECT id, username, role, level FROM users ORDER BY level DESC", [], (err, rows) => res.json({ success: true, data: rows }));
});

app.post('/api/staff/action', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false});
    const { targetId, action } = req.body;
    
    db.get("SELECT level FROM users WHERE id = ?", [targetId], (err, targetUser) => {
        if(!targetUser || req.user.level <= targetUser.level) return res.status(403).json({success: false, message: "Nie możesz usunąć kogoś z wyższą rangą."});
        if(action === 'delete') db.run("DELETE FROM users WHERE id = ?", [targetId]);
        res.json({ success: true, message: "Konto usunięte." });
    });
});

// --- PLAYERS ---
app.get('/api/players/search/:username', authenticate, (req, res) => {
    // W pełni działająca symulacja
    res.json({ success: true, data: { username: req.params.username, roblox_id: "Wykryte ID", currency: 4200, exploit_score: 5, is_banned: 0 } });
});

// ==========================================
// MOSTEK ROBLOX-API (Komunikacja z grą)
// ==========================================
let activeServers = {}; // Przechowuje live serwery
let pendingActions = []; // Kolejka poleceń dla Robloxa (np. Broadcast)

// Z panelu WWW na Serwer:
app.post('/api/servers/action', authenticate, (req, res) => {
    const { type, payload } = req.body;
    pendingActions.push({ id: Date.now(), type, payload, timestamp: Date.now() });
    
    io.emit('system_alert', { type: 'warning', message: `Wysłano komendę ${type} do serwerów gry.` });
    res.json({ success: true });
});

// Z Robloxa do Serwera (Heartbeat co 5 sekund):
app.post('/api/roblox/sync', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    
    const { jobId, players, ping } = req.body;
    // Zapisz/Zaktualizuj status serwera
    activeServers[jobId] = { players, ping, lastSeen: Date.now() };

    // Wyślij najnowsze akcje z kolejki z ostatnich 10 sekund
    const recentActions = pendingActions.filter(a => Date.now() - a.timestamp < 10000);

    res.json({ actions: recentActions });
});

// API dla panelu do pobierania serwerów
app.get('/api/servers', authenticate, (req, res) => {
    const now = Date.now();
    // Usuń martwe serwery (brak odpowiedzi > 15s)
    Object.keys(activeServers).forEach(jobId => { if(now - activeServers[jobId].lastSeen > 15000) delete activeServers[jobId]; });
    res.json({ success: true, data: activeServers });
});

// WebSockets dla UI wykresu
setInterval(() => {
    // Policz wszystkich graczy na wszystkich żywych serwerach
    let totalPlayers = 0;
    Object.values(activeServers).forEach(s => totalPlayers += s.players);
    io.emit('live_stats', { playersOnline: totalPlayers, tps: 60 });
}, 2000);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`🚀 OMNI-OS Enterprise Server (v9) uruchomiony!`));
