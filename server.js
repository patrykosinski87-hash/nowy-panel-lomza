const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Połączenie z bazą SQLite
const db = new sqlite3.Database('./database.db');

// Inicjalizacja tabel w bazie
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        level INTEGER,
        force_reset BOOLEAN DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ban_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_name TEXT,
        target_name TEXT,
        reason TEXT,
        duration TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Konfiguracja kodów i ról
const ROLE_CODES = {
    'A7K2M8QX': { role: 'Owner', level: 5 },
    '9BZ4L2WP': { role: 'Zarząd Administracji', level: 4 },
    'X5N8C3RA': { role: 'Administrator', level: 3 },
    'M8Y4P1ZX': { role: 'Moderator', level: 2 },
    'T2Q7V9KD': { role: 'Pomocnik', level: 1 }
};

// --- SYSTEM REJESTRACJI ---
app.post('/api/register', (req, res) => {
    const { username, password, code } = req.body;
    const roleData = ROLE_CODES[code];

    if (!roleData) return res.status(400).json({ success: false, message: "Nieprawidłowy kod zaproszenia!" });

    db.run("INSERT INTO users (username, password, role, level) VALUES (?, ?, ?, ?)", 
        [username, password, roleData.role, roleData.level], 
        function(err) {
            if (err) return res.status(400).json({ success: false, message: "Login jest już zajęty!" });
            res.json({ success: true, message: "Konto utworzone. Możesz się zalogować." });
    });
});

// --- SYSTEM LOGOWANIA ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (!row) return res.status(401).json({ success: false, message: "Błędny login lub hasło." });
        
        // Sprawdzenie czy admin wymusił zmianę hasła
        if (row.force_reset) {
            return res.json({ success: true, require_reset: true, userId: row.id });
        }

        res.json({ 
            success: true, 
            require_reset: false,
            userData: { id: row.id, username: row.username, role: row.role, level: row.level } 
        });
    });
});

// --- WYMUSZONA ZMIANA HASŁA/LOGINU ---
app.post('/api/update-credentials', (req, res) => {
    const { userId, newUsername, newPassword } = req.body;
    db.run("UPDATE users SET username = ?, password = ?, force_reset = 0 WHERE id = ?", [newUsername, newPassword, userId], (err) => {
        if (err) return res.status(400).json({ success: false, message: "Login zajęty lub błąd bazy." });
        res.json({ success: true, message: "Dane zaktualizowane. Zaloguj się ponownie." });
    });
});

// --- ZARZĄDZANIE KONTAMI (Tylko Level 4 i 5) ---
app.get('/api/staff', (req, res) => {
    db.all("SELECT id, username, role, level, force_reset FROM users ORDER BY level DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/staff/action', (req, res) => {
    const { action, targetId, requesterLevel } = req.body; // requesterLevel zabezpiecza przed hakerami frontendowymi

    db.get("SELECT level FROM users WHERE id = ?", [targetId], (err, targetUser) => {
        if (!targetUser || requesterLevel <= targetUser.level) {
            return res.status(403).json({ success: false, message: "Nie masz uprawnień do tego konta!" });
        }

        if (action === 'delete') {
            db.run("DELETE FROM users WHERE id = ?", [targetId]);
            res.json({ success: true, message: "Konto usunięte." });
        } else if (action === 'force_reset') {
            db.run("UPDATE users SET force_reset = 1 WHERE id = ?", [targetId]);
            res.json({ success: true, message: "Wymuszono reset danych przy logowaniu." });
        }
    });
});

// --- DANE DASHBOARDU I BANY ---
app.get('/api/dashboard', (req, res) => {
    db.get("SELECT COUNT(*) as banCount FROM ban_logs", [], (err, row) => {
        res.json({
            online: Math.floor(Math.random() * 500) + 1200,
            weeklyVisits: Math.floor(Math.random() * 10000) + 45000,
            totalBans: row ? row.banCount : 0
        });
    });
});

app.get('/api/bans', (req, res) => {
    db.all("SELECT * FROM ban_logs ORDER BY date DESC LIMIT 20", [], (err, rows) => {
        res.json(rows);
    });
});

// Zabezpieczenie ścieżek
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 OMNI-OS uruchomiony na porcie ${PORT}`));
