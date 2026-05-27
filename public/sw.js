self.addEventListener('install', (event) => {
    console.log('Apka zainstalowana!');
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
