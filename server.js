const express = require('express');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // WebSockets dla Real-Time UI

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "Omni_Ultra_Secret_Key_Production_2024!@#";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- BAZA DANYCH ---
const db = new sqlite3.Database('./enterprise.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        permissions TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- MIDDLEWARE BEZPIECZEŃSTWA (Ochrona ścieżek) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: "Brak tokenu dostępu" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Nieważny token" });
        req.user = user;
        next();
    });
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Brak uprawnień do tej akcji" });
        }
        next();
    };
};

// --- SYSTEM AUTH (Logowanie z JWT i Bcrypt) ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password, roleCode } = req.body;
    
    // Uproszczony system kodów dla demonstracji
    const roleMap = { 'OWNER123': 'Owner', 'MOD123': 'Moderator' };
    const role = roleMap[roleCode];
    if (!role) return res.status(400).json({ error: "Zły kod roli" });

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
        [username, hashedPassword, role], function(err) {
        if (err) return res.status(400).json({ error: "Login zajęty" });
        res.json({ success: true, message: "Konto utworzone!" });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Błędne dane logowania" });
        }

        // Generowanie tokenu JWT (ważny 24h)
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        // Zapis do Audit Logu
        db.run("INSERT INTO audit_logs (user_id, action, ip_address) VALUES (?, ?, ?)", 
            [user.id, 'USER_LOGIN', req.ip]);

        res.json({ success: true, token, user: { username: user.username, role: user.role } });
    });
});

// --- ZABEZPIECZONE ENDPOINTY API ---
app.get('/api/system/health', authenticateToken, (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), user: req.user.username });
});

// --- WEBSOCKETS (Prawdziwy Real-Time z serwera) ---
io.on('connection', (socket) => {
    console.log('Nowy klient połączony (UI)');

    // Symulacja danych przychodzących z silnika Roblox na żywo co 2 sekundy
    const liveStatsInterval = setInterval(() => {
        socket.emit('live_stats', {
            playersOnline: Math.floor(Math.random() * 2000) + 5000,
            activeServers: Math.floor(Math.random() * 50) + 150,
            tps: (60 - Math.random() * 2).toFixed(1),
            cpuUsage: (Math.random() * 40 + 20).toFixed(1)
        });
    }, 2000);

    // Symulacja losowych alertów (Live Moderation Feed)
    const alertInterval = setInterval(() => {
        if(Math.random() > 0.7) { // 30% szans co 5s na alert
            socket.emit('system_alert', {
                type: 'warning',
                message: `Wykryto anomalię u gracza Player_${Math.floor(Math.random()*9999)}`,
                module: 'Anti-Cheat'
            });
        }
    }, 5000);

    socket.on('disconnect', () => {
        clearInterval(liveStatsInterval);
        clearInterval(alertInterval);
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`🚀 OMNI-OS Enterprise Server (JWT/WS) na porcie ${PORT}`));
