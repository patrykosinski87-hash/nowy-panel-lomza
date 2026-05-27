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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./enterprise.db');

// --- ZAAWANSOWANA STRUKTURA BAZY DANYCH ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, level INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_name TEXT, action TEXT, target TEXT, details TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    // Symulacja bazy danych graczy z gry Roblox
    db.run(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, roblox_id TEXT, username TEXT, currency INTEGER, exploit_score INTEGER, is_banned BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, player TEXT, type TEXT, reason TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

// Middleware Autoryzacji
const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: "Brak dostępu" });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Sesja wygasła" });
        req.user = user; next();
    });
};

// Autoryzacja i Logowanie (Z Twojego poprzedniego kodu)
app.post('/api/auth/register', async (req, res) => { /* ... kod z poprzedniej wiadomosci ... */ });
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: "Błędne dane" });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, level: user.level }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, role: user.role } });
    });
});

// ==========================================
// MODUŁ 1: ZARZĄDZANIE GRACZAMI
// ==========================================

// 1. Wyszukiwarka Gracza
app.get('/api/players/search/:username', authenticate, (req, res) => {
    const target = req.params.username;
    
    // W prawdziwym środowisku tu byłby strzał do API Robloxa. My symulujemy bazę.
    db.get("SELECT * FROM players WHERE username LIKE ?", [`%${target}%`], (err, player) => {
        if (player) {
            res.json({ success: true, data: player });
        } else {
            // Jeśli gracza nie ma w naszej bazie SQL, tworzymy mu "mock" profil dla testów
            const mockPlayer = {
                roblox_id: Math.floor(Math.random() * 999999999),
                username: target,
                currency: Math.floor(Math.random() * 50000),
                exploit_score: Math.floor(Math.random() * 100),
                is_banned: 0
            };
            db.run("INSERT INTO players (roblox_id, username, currency, exploit_score) VALUES (?, ?, ?, ?)", [mockPlayer.roblox_id, mockPlayer.username, mockPlayer.currency, mockPlayer.exploit_score]);
            res.json({ success: true, data: mockPlayer });
        }
    });
});

// 2. Akcje Moderatorskie (Ban, Kick)
app.post('/api/players/action', authenticate, (req, res) => {
    const { targetUsername, actionType, reason } = req.body;
    const adminName = req.user.username;

    if(actionType === 'BAN') {
        db.run("UPDATE players SET is_banned = 1 WHERE username = ?", [targetUsername]);
    }

    // Zapis do logów kar
    db.run("INSERT INTO punishments (admin, player, type, reason) VALUES (?, ?, ?, ?)", [adminName, targetUsername, actionType, reason]);
    
    // Zapis do Audit Logu
    db.run("INSERT INTO audit_logs (admin_name, action, target, details) VALUES (?, ?, ?, ?)", [adminName, actionType, targetUsername, reason]);

    // MAGIA: Wysyłamy informację do wszystkich innych adminów na żywo!
    io.emit('system_alert', { 
        type: actionType === 'BAN' ? 'error' : 'warning', 
        message: `Admin ${adminName} wykonał ${actionType} na graczu ${targetUsername}. Powód: ${reason}` 
    });

    res.json({ success: true, message: `Akcja ${actionType} wykonana pomyślnie.` });
});

// WebSockety
io.on('connection', (socket) => {
    // Live telemetria
    setInterval(() => socket.emit('live_stats', { playersOnline: Math.floor(Math.random() * 2000) + 15000, tps: (59 + Math.random()).toFixed(1) }), 2000);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`🚀 Enterprise Server OMNI-OS (v8) na porcie ${PORT}`));
