const express = require('express');
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Uruchamiamy WebSockety na serwerze

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "Omni_Ultra_Secret_Key_2024!";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Baza danych (Role i Szyfrowanie)
const db = new sqlite3.Database('./enterprise.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT
    )`);
});

// Rejestracja
app.post('/api/auth/register', async (req, res) => {
    const { username, password, roleCode } = req.body;
    
    // Kody ról z Twojego poprzedniego polecenia
    const codes = {
        'A7K2M8QX': 'Owner', '9BZ4L2WP': 'Zarząd', 'X5N8C3RA': 'Admin', 
        'M8Y4P1ZX': 'Moderator', 'T2Q7V9KD': 'Pomocnik'
    };
    
    if (!codes[roleCode]) return res.status(400).json({ success: false, message: "Zły kod roli!" });

    // Szyfrowanie hasła (nie do złamania)
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
        [username, hashedPassword, codes[roleCode]], function(err) {
        if (err) return res.status(400).json({ success: false, message: "Login zajęty!" });
        res.json({ success: true, message: "Konto utworzone. Zaloguj się!" });
    });
});

// Logowanie
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: "Błędne dane logowania" });
        }
        // Generujemy bezpieczny token na 24h
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { username: user.username, role: user.role } });
    });
});

// SYSTEM LIVE (WebSockets)
io.on('connection', (socket) => {
    console.log('Nowy admin połączony z panelem');

    // Wypycha dane na żywo do panelu co 2 sekundy (Tylko dla pokazania działania systemu)
    const liveStats = setInterval(() => {
        socket.emit('live_stats', {
            playersOnline: Math.floor(Math.random() * 2000) + 15000,
            tps: (59 + Math.random()).toFixed(1)
        });
    }, 2000);

    // Losowe alerty z Anti-Cheata na żywo co kilka sekund
    const alerts = setInterval(() => {
        if(Math.random() > 0.6) {
            socket.emit('system_alert', { message: `Wykryto anomalię ruchu u gracza (ID: ${Math.floor(Math.random()*9999)})`, type: 'warning' });
        }
    }, 8000);

    socket.on('disconnect', () => {
        clearInterval(liveStats);
        clearInterval(alerts);
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`🚀 OMNI-OS Enterprise Server (JWT/WS) na porcie ${PORT}`));
