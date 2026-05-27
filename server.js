const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = 'TX_ELITE_ULTRA_2024_PRO';
const REGISTER_CODE = 'LOMZA-ADMIN-2024';
const ROBLOX_KEY = 'LOMZA_SECRET_KEY_123';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    // Tworzenie tabel (jeśli nie istnieją)
    db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, money INTEGER, level INTEGER, status TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, action TEXT, target TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    
    // Tabela akcji oczekujących (Z DODATKOWYMI KOLUMNAMI)
    db.run(`CREATE TABLE IF NOT EXISTS pending_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        target_id INTEGER, 
        action TEXT, 
        reason TEXT, 
        duration TEXT, 
        extra_data TEXT
    )`);
});

const protect = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Zaloguj się' });
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch (e) { res.status(401).json({ error: 'Sesja wygasła' }); }
};

// --- API ---
app.get('/api/check', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ loggedIn: false });
    try {
        const decoded = jwt.verify(token, SECRET);
        res.json({ loggedIn: true, user: decoded });
    } catch (e) { res.json({ loggedIn: false }); }
});

app.get('/api/data', protect, (req, res) => {
    db.all("SELECT * FROM players", (err, players) => {
        db.all("SELECT id, username, role FROM staff", (err, staff) => {
            db.all("SELECT * FROM logs ORDER BY time DESC LIMIT 15", (err, logs) => {
                res.json({ players: players || [], staff: staff || [], logs: logs || [] });
            });
        });
    });
});

app.post('/api/announcement', protect, (req, res) => {
    const { message } = req.body;
    db.run("INSERT INTO pending_actions (action, extra_data) VALUES (?, ?)", ['ANNOUNCEMENT', message], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run("INSERT INTO logs (admin, action, target) VALUES (?, ?, ?)", [req.user.name, 'OGŁOSZENIE', 'Wszyscy']);
        res.json({ success: true });
    });
});

app.post('/api/action', protect, (req, res) => {
    const { action, id, name, reason, duration } = req.body;
    db.run("INSERT INTO pending_actions (target_id, action, reason, duration) VALUES (?, ?, ?, ?)", [id, action, reason, duration || 'perm'], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run("INSERT INTO logs (admin, action, target) VALUES (?, ?, ?)", [req.user.name, action, `${name} (${reason})`]);
        res.json({ success: true });
    });
});

app.post('/api/roblox/sync', (req, res) => {
    const { key, playerList } = req.body;
    if (key !== ROBLOX_KEY) return res.status(403).send("Forbidden");

    db.run("DELETE FROM players", () => {
        const stmt = db.prepare("INSERT INTO players (id, name, money, level, status) VALUES (?, ?, ?, ?, 'Online')");
        if (playerList) {
            playerList.forEach(p => stmt.run(p.userId, p.name, p.money, p.level));
        }
        stmt.finalize();
    });

    db.all("SELECT * FROM pending_actions", (err, rows) => {
        res.json({ actions: rows || [] });
        db.run("DELETE FROM pending_actions");
    });
});

app.post('/api/register', async (req, res) => {
    const { username, password, code } = req.body;
    if (code !== REGISTER_CODE) return res.status(403).json({ error: 'Błędny kod' });
    const hash = await bcrypt.hash(password, 10);
    db.get("SELECT COUNT(*) as count FROM staff", (err, row) => {
        const role = (row && row.count === 0) ? 'Owner' : 'Moderator';
        db.run("INSERT INTO staff (username, password, role) VALUES (?, ?, ?)", [username, hash, role], (err) => {
            if (err) return res.status(400).json({ error: 'User exists' });
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM staff WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Błędne dane' });
        const token = jwt.sign({ id: user.id, name: user.username, role: user.role }, SECRET, { expiresIn: '24h' });
        res.cookie('token', token, { httpOnly: true, path: '/', maxAge: 24*60*60*1000, sameSite: 'Lax' });
        res.json({ success: true });
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token', { path: '/' });
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
