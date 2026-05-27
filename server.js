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
const ROBLOX_KEY = 'LOMZA_SECRET_KEY_123'; // Klucz bezpieczeństwa (taki sam w Robloxie!)

app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT)`);
    // Tabela graczy jest teraz czyszczona przy starcie, bo dane bierzemy z serwera gry
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, money INTEGER, level INTEGER, status TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, action TEXT, target TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS pending_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id INTEGER, action TEXT, reason TEXT)`);
});

// Middleware ochrony
const protect = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Auth Required' });
    try { req.user = jwt.verify(token, SECRET); next(); } 
    catch (e) { res.status(401).json({ error: 'Session Expired' }); }
};

// --- API DLA PANELU (FRONTEND) ---
app.get('/api/data', protect, (req, res) => {
    db.all("SELECT * FROM players", (err, players) => {
        db.all("SELECT id, username, role FROM staff", (err, staff) => {
            db.all("SELECT * FROM logs ORDER BY time DESC LIMIT 15", (err, logs) => {
                res.json({ players, staff, logs });
            });
        });
    });
});

app.post('/api/action', protect, (req, res) => {
    const { action, id, name, reason } = req.body;
    // Dodajemy akcję do wykonania w grze
    db.run("INSERT INTO pending_actions (target_id, action, reason) VALUES (?, ?, ?)", [id, action, reason]);
    db.run("INSERT INTO logs (admin, action, target) VALUES (?, ?, ?)", [req.user.name, action, `${name} (${reason})`]);
    res.json({ success: true });
});

// --- API DLA ROBLOXA (KOMUNIKACJA Z GRĄ) ---
app.post('/api/roblox/sync', (req, res) => {
    const { key, playerList } = req.body;
    if (key !== ROBLOX_KEY) return res.status(403).send("Forbidden");

    // Czyścimy starą listę i wpisujemy aktualną z gry
    db.run("DELETE FROM players", () => {
        const stmt = db.prepare("INSERT INTO players (id, name, money, level, status) VALUES (?, ?, ?, ?, 'Online')");
        playerList.forEach(p => stmt.run(p.userId, p.name, p.money, p.level));
        stmt.finalize();
    });

    // Wysyłamy do gry listę akcji do wykonania (np. bany/kicki)
    db.all("SELECT * FROM pending_actions", (err, rows) => {
        res.json({ actions: rows });
        db.run("DELETE FROM pending_actions"); // Czyścimy wykonane akcje
    });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
