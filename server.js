const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Kod dostępu (możesz go tu zmienić)
const SECRET_ACCESS_CODE = "OMNI-2024";

// Middleware - pozwala serwerowi czytać dane wysyłane z formularzy (JSON)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ENDPOINT 1: Logowanie
app.post('/api/login', (req, res) => {
    const userCode = req.body.code;
    
    if (userCode === SECRET_ACCESS_CODE) {
        // Zwracamy wirtualny token (sukces)
        res.json({ success: true, token: "authorized_admin_777" });
    } else {
        // Błędny kod
        res.status(401).json({ success: false, message: "Odmowa dostępu. Nieprawidłowy kod." });
    }
});

// ENDPOINT 2: Pobieranie danych (Działa jak wcześniej)
app.get('/api/check', (req, res) => {
    res.json({
        status: "success",
        data: {
            playersOnline: Math.floor(Math.random() * 500) + 1000,
            activeServers: 42,
            threatLevel: "LOW",
            revenue: "$12,420",
            tps: "59.8"
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 OMNI-OS uruchomiony na porcie ${PORT}`);
});
