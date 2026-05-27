const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
// Render dynamicznie przydziela port, dlatego używamy process.env.PORT
const PORT = process.env.PORT || 4000;
const SECRET = 'TX_ELITE_ULTRA_2024_PRO';
const REGISTER_CODE = 'LOMZA-ADMIN-2024';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, last_login DATETIME)`);
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT, money INTEGER, level INTEGER, status TEXT DEFAULT 'Online', warnings INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, action TEXT, target TEXT, time DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    db.get("SELECT COUNT(*) as count FROM players", (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO players (id, name, money, level) VALUES (1, 'wexxx_', 500000, 100), (2, 'Marek_Turbo', 1500, 12), (3, 'Kowal_RP', 450, 2)");
        }
    });
});

const protect = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Auth Required' });
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch (e) { res.status(401).json({ error: 'Session Expired' }); }
};

app.post('/api/register', async (req, res) => {
    const { username, password, code } = req.body;
    if (code !== REGISTER_CODE) return res.status(403).json({ error: 'Błędny kod zaproszenia' });
    const hash = await bcrypt.hash(password, 10);
    db.get("SELECT COUNT(*) as count FROM staff", (err, row) => {
        const role = (row && row.count === 0) ? 'Owner' : 'Moderator';
        db.run("INSERT INTO staff (username, password, role) VALUES (?, ?, ?)", [username, hash, role], (err) => {
            if (err) return res.status(400).json({ error: 'Użytkownik już istnieje' });
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM staff WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Błędne dane' });
        const token = jwt.sign({ id: user.id, name: user.username, role: user.role }, SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, path: '/', maxAge: 7*24*60*60*1000, sameSite: 'strict' });
        res.json({ success: true });
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token', { path: '/' });
    res.json({ success: true });
});

app.get('/api/check', (req, res) => {
    try {
        const d = jwt.verify(req.cookies.token, SECRET);
        res.json({ loggedIn: true, user: d });
    } catch (e) { res.json({ loggedIn: false }); }
});

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
    let query = "";
    if(action === 'BAN') query = `UPDATE players SET status = 'Banned' WHERE id = ${id}`;
    if(action === 'KICK') query = `UPDATE players SET status = 'Offline' WHERE id = ${id}`;
    if(action === 'WARN') query = `UPDATE players SET warnings = warnings + 1 WHERE id = ${id}`;

    db.run(query, [], () => {
        db.run("INSERT INTO logs (admin, action, target) VALUES (?, ?, ?)", [req.user.name, action, `${name} (${reason})`]);
        res.json({ success: true });
    });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
