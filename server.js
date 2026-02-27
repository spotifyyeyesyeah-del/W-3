const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// ==================== БАЗА ДАННЫХ ====================
const DB_FILE = path.join(__dirname, 'w3-database.json');

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (!parsed.tokens) parsed.tokens = [];
            if (!parsed.lastId) parsed.lastId = 0;
            return parsed;
        }
    } catch(e) { console.error('[DB] Ошибка загрузки:', e.message); }
    return { tokens: [], lastId: 0 };
}

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
    catch(e) { console.error('[DB] Ошибка сохранения:', e.message); }
}

let db = loadDB();

// ==================== CONFIG ====================
// ВАЖНО: замени на свой секрет и URL мессенджера
const W3_SECRET = 'W3_SECRET_2026';

// ==================== УТИЛИТЫ ====================
function genToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const rand = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `W3-${rand(8)}-${rand(8)}-${rand(8)}-${rand(8)}`;
}

// ==================== CORS (разрешаем мессенджеру) ====================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ==================== API ====================

// Регистрация нового пользователя W:3
app.post('/api/w3/create', (req, res) => {
    const { username, password, phone, email, secret } = req.body;

    // Проверка секрета (для вызова с мессенджера или напрямую)
    if (secret !== W3_SECRET) return res.status(403).json({ success: false, error: 'forbidden' });
    if (!username || !password) return res.status(400).json({ success: false, error: 'Нет данных' });
    if (username.length < 2) return res.json({ success: false, error: 'Имя слишком короткое' });
    if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]+$/.test(username)) return res.json({ success: false, error: 'Недопустимые символы' });

    // Проверяем уникальность
    const exists = db.tokens.find(t => t.username.toLowerCase() === username.toLowerCase());
    if (exists) return res.json({ success: false, error: 'taken' });

    db.lastId++;
    const token = genToken();
    db.tokens.push({
        id: db.lastId,
        token,
        username,
        password,
        phone: phone || '',
        email: email || '',
        createdAt: Date.now(),
        lastLogin: null
    });
    saveDB();

    console.log(`[W3] Новый пользователь: ${username}`);
    res.json({ success: true, token });
});

// Вход — проверяем логин/пароль, возвращаем токен
app.post('/api/w3/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Нет данных' });

    const user = db.tokens.find(t => t.username.toLowerCase() === username.toLowerCase() && t.password === password);
    if (!user) return res.json({ success: false, error: 'not_found' });

    user.lastLogin = Date.now();
    saveDB();
    res.json({ success: true, token: user.token, username: user.username });
});

// Проверка токена (вызывается мессенджером)
app.post('/api/w3/verify', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false });

    const user = db.tokens.find(t => t.token === token);
    if (!user) return res.json({ success: false, error: 'invalid' });

    res.json({
        success: true,
        username: user.username,
        phone: user.phone,
        email: user.email,
        createdAt: user.createdAt
    });
});

// Список всех токенов (только с секретом — для твоего просмотра)
app.post('/api/w3/all', (req, res) => {
    const { secret } = req.body;
    if (secret !== W3_SECRET) return res.status(403).json({ success: false, error: 'forbidden' });
    res.json({
        success: true,
        count: db.tokens.length,
        tokens: db.tokens.map(t => ({
            id: t.id,
            username: t.username,
            token: t.token,
            phone: t.phone,
            email: t.email,
            createdAt: t.createdAt,
            lastLogin: t.lastLogin
        }))
    });
});

// ==================== СТАРТ ====================
app.listen(PORT, () => {
    console.log(`[W3] Сервер запущен на порту ${PORT}`);
    console.log(`[W3] Пользователей в базе: ${db.tokens.length}`);
});
