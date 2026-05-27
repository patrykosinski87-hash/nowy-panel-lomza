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

// ==========================================
// 🛠️ KONFIGURACJA DISCORD WEBHOOKÓW 🛠️
// ==========================================
const WEBHOOK_BANS = "TUTAJ_WKLEJ_LINK_WEBHOOKA_TYLKO_DO_BANOW";
const WEBHOOK_AUDIT = "TUTAJ_WKLEJ_LINK_WEBHOOKA_DO_RESZTY_LOGOW";

// ID Roli lub Użytkownika do PINGOWANIA przy banie (opcjonalnie)
// Jak zostawisz puste "", to wyśle samą ramkę bez pingu nad nią.
const PING_ID = "<@&TUTAJ_ID_ROLI>"; 

// Funkcja wysyłająca klasyczne logi (Audit)
async function sendDiscordLog(webhookUrl, embed) {
    if (!webhookUrl || webhookUrl.includes("TUTAJ_WKLEJ")) return; 
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (err) { console.error("Błąd Webhooka Discord:", err); }
}
// ==========================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./enterprise.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, level INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT, player TEXT, type TEXT, reason TEXT, duration TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP)`);
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
            sendDiscordLog(WEBHOOK_AUDIT, { title: "👤 Nowy Administrator", description: `Stworzono nowe konto w panelu.\n**Login:** ${username}\n**Ranga:** ${roleData.role}`, color: 3447003 });
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
    db.get("SELECT * FROM users WHERE id = ?", [req.body.targetId], (err, targetUser) => {
        if(!targetUser || req.user.level <= targetUser.level) return res.status(403).json({success: false, message: "Brak uprawnień do tego konta."});
        db.run("DELETE FROM users WHERE id = ?", [req.body.targetId]);
        sendDiscordLog(WEBHOOK_AUDIT, { title: "🗑️ Zwolnienie Administratora", description: `Admin **${req.user.username}** usunął konto należące do **${targetUser.username}** (${targetUser.role}).`, color: 15158332 });
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
        sendDiscordLog(WEBHOOK_AUDIT, { title: "🕊️ Zdjęcie Bana (UNBAN)", description: `Admin **${req.user.username}** odbanował gracza **${req.body.username}**.`, color: 3066993 });
        res.json({ success: true });
    });
});

// --- MOSTEK ROBLOX-API ---
let activeServers = {}; 
let pendingActions = []; 

app.get('/api/roblox/check-ban/:username', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    db.get("SELECT * FROM active_bans WHERE username = ?", [req.params.username], (err, row) => {
        if (row) res.json({ banned: true, reason: row.reason, duration: row.duration });
        else res.json({ banned: false });
    });
});

app.post('/api/roblox/sync', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    activeServers[req.body.jobId] = { players: req.body.players || [], ping: req.body.ping, lastSeen: Date.now() };
    const recentActions = pendingActions.filter(a => Date.now() - a.timestamp < 10000);
    res.json({ actions: recentActions });
});

// ODBIERANIE AKCJI Z PANELU WWW
app.post('/api/servers/action', authenticate, (req, res) => {
    const { type, payload, target, reason, duration } = req.body;
    pendingActions.push({ id: Date.now(), type, payload, target, reason, duration, timestamp: Date.now() });
    
    if(type === 'BAN_PLAYER') {
        db.run("INSERT OR REPLACE INTO active_bans (username, reason, duration, admin) VALUES (?, ?, ?, ?)", [target, reason, duration, req.user.username]);
        db.run("INSERT INTO punishments (admin, player, type, reason, duration) VALUES (?, ?, ?, ?, ?)", [req.user.username, target, type, reason, duration]);
        
        // ========================================================
        // 🔴 IDEALNE ODWZOROWANIE DISCORD LOGA (1:1 Z OBRAZKIEM)
        // ========================================================
        
        // Formatuje gramatykę tak jak na screenie
        const durationText = (duration === "Permanentny") ? "permanentnie" : `na ${duration}`;

        const banPayload = {
            content: PING_ID, // Wyrzuca ping nad ramką, tak jak na screenie @typeczek2202
            embeds: [{
                title: "🔐 Zbanowano Gracza",
                color: 3447003, // Ten sam błękitny z obrazka
                description: `Zbanowany gracz nie może grać do czasu upłynięcia blokady.\nGracz **${target}** został zablokowany ${durationText}.\n\n**Powód** ${reason}\n\nZbanowano przez ${req.user.username}`,
                thumbnail: {
                    url: "https://i.imgur.com/gK9R5G0.png" // Czerwone logo Discorda, wprost ze screena
                }
            }]
        };

        // Wysyłamy specyficznie sformatowany Payload prosto do webhooka banów
        if(WEBHOOK_BANS && !WEBHOOK_BANS.includes("TUTAJ_WKLEJ")) {
            fetch(WEBHOOK_BANS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(banPayload) }).catch(err => console.error(err));
        }

        io.emit('system_alert', { type: 'error', message: `${req.user.username} zbanował ${target}` });

    } else if (type === 'KICK_PLAYER') {
        db.run("INSERT INTO punishments (admin, player, type, reason, duration) VALUES (?, ?, ?, ?, ?)", [req.user.username, target, type, reason, "N/A"]);
        sendDiscordLog(WEBHOOK_AUDIT, { title: "👞 Wyrzucenie (KICK)", description: `Admin **${req.user.username}** wyrzucił gracza **${target}**.\n**Powód:** ${reason}`, color: 15105570 });
        io.emit('system_alert', { type: 'warning', message: `${req.user.username} wyrzucił ${target}` });

    } else if (type === 'BROADCAST') {
        sendDiscordLog(WEBHOOK_AUDIT, { title: "📢 Globalne Ogłoszenie", description: `Admin **${req.user.username}** wysłał wiadomość:\n\`${payload}\``, color: 16776960 });
        io.emit('system_alert', { type: 'info', message: `Wysłano globalną komendę: BROADCAST` });

    } else if (type === 'SHUTDOWN') {
        sendDiscordLog(WEBHOOK_AUDIT, { title: "🛑 GLOBAL SHUTDOWN", description: `Admin **${req.user.username}** WYŁĄCZYŁ WSZYSTKIE SERWERY GRY!`, color: 16711680 });
        io.emit('system_alert', { type: 'error', message: `UWAGA: Wysłano komendę SHUTDOWN.` });
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
