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
const WEBHOOK_BANS = "https://discord.com/api/webhooks/1509231524443324517/9x-dT7uK76oF2CF3JOXZVF2f6ZFhML2A8dpYbAvz5ous44pqH7RX2ig631dRj7Sxiqfp";
const WEBHOOK_AUDIT = "https://discord.com/api/webhooks/1509231315591893103/TJyJMf4b4tDD4prdNZXu6B0aijLbEA503Ek3fVyrnv0mJTaLfDlQ5F8jONLoZTrs5Sz5";

const ROLE_MAP = { 1: 'Pomocnik', 2: 'Moderator', 3: 'Admin', 4: 'Zarząd', 5: 'Owner' };

async function sendDiscordLog(webhookUrl, embed) {
    if (!webhookUrl || webhookUrl.includes("TUTAJ_WKLEJ")) return; 
    try {
        await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) });
    } catch (err) { console.error("Błąd Webhooka Discord:", err); }
}

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

// ==========================================
// NOWE ZARZĄDZANIE ADMINISTRACJĄ (AWANSE/HASŁA)
// ==========================================
app.get('/api/staff', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false});
    db.all("SELECT id, username, role, level FROM users ORDER BY level DESC", [], (err, rows) => res.json({ success: true, data: rows }));
});

app.post('/api/staff/action', authenticate, (req, res) => {
    if(req.user.level < 4) return res.status(403).json({success: false, message: "Brak uprawnień."});
    const { targetId, action, payload } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [targetId], async (err, targetUser) => {
        if(!targetUser) return res.status(404).json({success: false, message: "Nie ma takiego admina."});
        if(req.user.level <= targetUser.level) return res.status(403).json({success: false, message: "Nie możesz edytować kogoś o swojej randze lub wyższej!"});

        if (action === 'delete') {
            db.run("DELETE FROM users WHERE id = ?", [targetId]);
            sendDiscordLog(WEBHOOK_AUDIT, { title: "🗑️ Zwolnienie Admina", description: `Admin **${req.user.username}** usunął konto należące do **${targetUser.username}** (${targetUser.role}).`, color: 15158332 });
            return res.json({ success: true, message: "Konto usunięte." });
        }
        
        if (action === 'promote') {
            const newLevel = targetUser.level + 1;
            if(newLevel >= req.user.level) return res.status(403).json({success: false, message: "Nie możesz awansować kogoś na rangę równą lub wyższą swojej!"});
            db.run("UPDATE users SET level = ?, role = ? WHERE id = ?", [newLevel, ROLE_MAP[newLevel], targetId]);
            sendDiscordLog(WEBHOOK_AUDIT, { title: "📈 Awans", description: `Admin **${req.user.username}** awansował **${targetUser.username}** na **${ROLE_MAP[newLevel]}**.`, color: 3066993 });
            return res.json({ success: true, message: `Awansowano na ${ROLE_MAP[newLevel]}.` });
        }

        if (action === 'demote') {
            const newLevel = targetUser.level - 1;
            if(newLevel < 1) return res.status(400).json({success: false, message: "Ten admin ma już najniższą rangę!"});
            db.run("UPDATE users SET level = ?, role = ? WHERE id = ?", [newLevel, ROLE_MAP[newLevel], targetId]);
            sendDiscordLog(WEBHOOK_AUDIT, { title: "📉 Degradacja", description: `Admin **${req.user.username}** zdegradował **${targetUser.username}** na **${ROLE_MAP[newLevel]}**.`, color: 15158332 });
            return res.json({ success: true, message: `Zdegradowano na ${ROLE_MAP[newLevel]}.` });
        }

        if (action === 'reset_username') {
            db.get("SELECT id FROM users WHERE username = ?", [payload], (err, row) => {
                if(row) return res.status(400).json({success: false, message: "Ten login jest już zajęty!"});
                db.run("UPDATE users SET username = ? WHERE id = ?", [payload, targetId]);
                sendDiscordLog(WEBHOOK_AUDIT, { title: "📝 Zmiana Loginu", description: `Admin **${req.user.username}** zmienił login pracownika z **${targetUser.username}** na **${payload}**.`, color: 16776960 });
                return res.json({ success: true, message: "Login został zmieniony." });
            });
        }

        if (action === 'reset_password') {
            const hashedPassword = await bcrypt.hash(payload, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, targetId]);
            sendDiscordLog(WEBHOOK_AUDIT, { title: "🔑 Zmiana Hasła", description: `Admin **${req.user.username}** wymusił nowe hasło dla **${targetUser.username}**.`, color: 16776960 });
            return res.json({ success: true, message: "Hasło zostało nadpisane." });
        }
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
let activeServers = {}; let pendingActions = []; 
app.get('/api/roblox/check-ban/:username', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    db.get("SELECT * FROM active_bans WHERE username = ?", [req.params.username], (err, row) => {
        if (row) res.json({ banned: true, reason: row.reason, duration: row.duration }); else res.json({ banned: false });
    });
});
app.post('/api/roblox/sync', (req, res) => {
    if(req.headers['x-api-key'] !== ROBLOX_API_KEY) return res.status(401).send("Unauthorized");
    activeServers[req.body.jobId] = { players: req.body.players || [], ping: req.body.ping, lastSeen: Date.now() };
    res.json({ actions: pendingActions.filter(a => Date.now() - a.timestamp < 10000) });
});
app.post('/api/servers/action', authenticate, (req, res) => {
    const { type, payload, target, reason, duration } = req.body;
    pendingActions.push({ id: Date.now(), type, payload, target, reason, duration, timestamp: Date.now() });
    
    if(type === 'BAN_PLAYER') {
        db.run("INSERT OR REPLACE INTO active_bans (username, reason, duration, admin) VALUES (?, ?, ?, ?)", [target, reason, duration, req.user.username]);
        db.run("INSERT INTO punishments (admin, player, type, reason, duration) VALUES (?, ?, ?, ?, ?)", [req.user.username, target, type, reason, duration]);
        
        const durationText = (duration === "Permanentny") ? "permanentnie" : `na ${duration}`;
        const banPayload = { embeds: [{ title: "🔐 Zbanowano Gracza", color: 3447003, description: `Zbanowany gracz nie może grać do czasu upłynięcia blokady.\nGracz **${target}** został zablokowany ${durationText}.\n\n**Powód** ${reason}\n\nZbanowano przez ${req.user.username}` }] };
        if(WEBHOOK_BANS && !WEBHOOK_BANS.includes("TUTAJ_WKLEJ")) { fetch(WEBHOOK_BANS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(banPayload) }).catch(e=>{}); }
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
