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
});

const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false });
    jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.status(403).json({ success: false }); req.user = user; next(); });
};

// Autoryzacja Adminów
app.post('/api/auth/login', (req, res) => {
    db.get("SELECT * FROM users WHERE username = ?", [req.body.username], async (err, user) => {
        if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ success: false, message: "Błędne dane" });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, level: user.level }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, role: user.role, level: user.level } });
    });
});
app.post('/api/auth/register', async (req, res) => { /* Twój działający kod rejestracji z poprzedniej wersji tu zostaje, skracam dla czytelności */ });

// --- MOSTEK ROBLOX-API ---
let activeServers = {}; 
let pendingActions = []; 

app.post('/api/roblox/sync', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    
    // Teraz `players` to tablica z obiektami {id, name}
    const { jobId, players, ping } = req.body;
    activeServers[jobId] = { players: players || [], ping, lastSeen: Date.now() };

    // Wysyłamy do serwera gry tylko te akcje, które mają max 10 sekund
    const recentActions = pendingActions.filter(a => Date.now() - a.timestamp < 10000);
    res.json({ actions: recentActions });
});

// Endpoint wysyłania komend moderatorskich do gry
app.post('/api/servers/action', authenticate, (req, res) => {
    const { type, payload, target, reason, duration } = req.body;
    pendingActions.push({ id: Date.now(), type, payload, target, reason, duration, timestamp: Date.now() });
    
    if(type === 'BAN_PLAYER' || type === 'KICK_PLAYER') {
        db.run("INSERT INTO punishments (admin, player, type, reason, duration) VALUES (?, ?, ?, ?, ?)", [req.user.username, target, type, reason, duration]);
        io.emit('system_alert', { type: type === 'BAN_PLAYER' ? 'error' : 'warning', message: `${req.user.username} wykonał ${type} na ${target}` });
    } else {
        io.emit('system_alert', { type: 'info', message: `Wysłano globalną komendę: ${type}` });
    }
    
    res.json({ success: true });
});

// Zwracanie DOKŁADNEJ listy graczy i serwerów do panelu UI
app.get('/api/live-data', authenticate, (req, res) => {
    const now = Date.now();
    let exactPlayerCount = 0;
    let allPlayersList = [];

    Object.keys(activeServers).forEach(jobId => { 
        if(now - activeServers[jobId].lastSeen > 15000) {
            delete activeServers[jobId]; // Usuń martwy serwer
        } else {
            exactPlayerCount += activeServers[jobId].players.length;
            allPlayersList = allPlayersList.concat(activeServers[jobId].players);
        }
    });

    res.json({ success: true, servers: activeServers, totalPlayers: exactPlayerCount, playerList: allPlayersList });
});

// WebSockets 
setInterval(() => {
    let exactPlayerCount = 0;
    Object.values(activeServers).forEach(s => exactPlayerCount += s.players.length);
    io.emit('live_stats', { playersOnline: exactPlayerCount, tps: 60 });
}, 2000);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`🚀 OMNI-OS Enterprise Server (v10) Live!`));
