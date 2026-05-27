const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serwowanie plików statycznych z folderu 'public' (TUTAJ BYŁ TWÓJ BŁĄD Z CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Dodajemy endpoint API, którego szukał Twój panel (NAPRAWA BŁĘDU 404)
app.get('/api/check', (req, res) => {
    // Symulacja danych pobieranych z serwera gry
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

// Odsyłanie index.html dla każdej innej ścieżki
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 OMNI-OS Engine uruchomiony na porcie ${PORT}`);
});
