const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const BIN_ID = process.env.JSONBIN_ID || '69a56f5eae596e708f579789';
const MASTER_KEY = process.env.JSONBIN_KEY || '$2a$10$uD45.KwCwC.i8B3avr4iCeg15hkTjNcrzUFwFbKmZlrMAoJtHdo6u';
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 8000;

async function readDB() {
    const now = Date.now();
    if (_cache && (now - _cacheTime) < CACHE_TTL) return _cache;
    try {
        const r = await fetch(BIN_URL + '/latest', { headers: { 'X-Master-Key': MASTER_KEY } });
        const d = await r.json();
        const db = d.record || {};
        if (!db.users) db.users = [];
        if (!db.posts) db.posts = [];
        if (!db.messages) db.messages = [];
        if (!db.chats) db.chats = [];
        if (!db.groups) db.groups = [];
        if (!db.groupMessages) db.groupMessages = [];
        if (!db.lastId) db.lastId = 0;
        _cache = db;
        _cacheTime = now;
        return db;
    } catch(e) {
        console.error('[DB] read error:', e.message);
        return _cache || { users:[], posts:[], messages:[], chats:[], groups:[], groupMessages:[], lastId:0 };
    }
}

async function writeDB(db) {
    _cache = db;
    _cacheTime = Date.now();
    try {
        await fetch(BIN_URL, {
            method: 'PUT',
            headers: { 'X-Master-Key': MASTER_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(db)
        });
    } catch(e) { console.error('[DB] write error:', e.message); }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ===== AUTH =====
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, displayName } = req.body;
        if (!username || !password) return res.json({ success: false, error: 'Заполни все поля' });
        if (username.length < 2) return res.json({ success: false, error: 'Имя минимум 2 символа' });
        if (password.length < 4) return res.json({ success: false, error: 'Пароль минимум 4 символа' });
        if (!/^[a-zA-Zа-яА-ЯёЁ0-9_]+$/.test(username)) return res.json({ success: false, error: 'Только буквы, цифры и _' });
        const db = await readDB();
        if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
            return res.json({ success: false, error: 'Имя уже занято' });
        const user = {
            id: uid(), username, password,
            displayName: displayName || username,
            bio: '', avatar: '', wallpaper: '',
            followers: [], following: [],
            createdAt: Date.now()
        };
        db.users.push(user);
        await writeDB(db);
        res.json({ success: true, id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, followers: [], following: [] });
    } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const db = await readDB();
        const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
        if (!user) return res.json({ success: false, error: 'Неверное имя или пароль' });
        res.json({ success: true, id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar || '', bio: user.bio || '', wallpaper: user.wallpaper || '', followers: user.followers || [], following: user.following || [] });
    } catch(e) { res.json({ success: false, error: 'Ошибка сервера' }); }
});

// ===== POSTS =====
app.get('/api/posts', async (req, res) => {
    try {
        const { userId, feed } = req.query;
        const db = await readDB();
        let posts = [...db.posts].sort((a, b) => b.createdAt - a.createdAt);
        if (userId && !feed) posts = posts.filter(p => p.userId === userId);
        if (feed && userId) {
            const user = db.users.find(u => u.id === userId);
            const following = user?.following || [];
            posts = posts.filter(p => following.includes(p.userId) || p.userId === userId);
        }
        // Attach author info
        posts = posts.map(p => {
            const author = db.users.find(u => u.id === p.userId);
            return { ...p, authorName: author?.displayName || author?.username || '?', authorAvatar: author?.avatar || '', authorUsername: author?.username || '' };
        });
        res.json(posts);
    } catch(e) { res.json([]); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const { userId, text, image } = req.body;
        if (!userId || !text?.trim()) return res.json({ success: false, error: 'Нет текста' });
        const db = await readDB();
        const user = db.users.find(u => u.id === userId);
        if (!user) return res.json({ success: false, error: 'Нет пользователя' });
        const post = { id: uid(), userId, text: text.trim(), image: image || '', likes: [], comments: [], createdAt: Date.now() };
        db.posts.unshift(post);
        if (db.posts.length > 1000) db.posts = db.posts.slice(0, 1000);
        await writeDB(db);
        res.json({ success: true, post: { ...post, authorName: user.displayName || user.username, authorAvatar: user.avatar || '', authorUsername: user.username } });
    } catch(e) { res.json({ success: false, error: 'Ошибка' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const { userId } = req.body;
        const db = await readDB();
        const post = db.posts.find(p => p.id === req.params.id);
        if (!post) return res.json({ success: false });
        if (post.userId !== userId) return res.json({ success: false, error: 'Нет доступа' });
        db.posts = db.posts.filter(p => p.id !== req.params.id);
        await writeDB(db);
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
        const db = await readDB();
        const post = db.posts.find(p => p.id === req.params.id);
        if (!post) return res.json({ success: false });
        if (!post.likes) post.likes = [];
        const idx = post.likes.indexOf(userId);
        if (idx === -1) post.likes.push(userId);
        else post.likes.splice(idx, 1);
        await writeDB(db);
        res.json({ success: true, likes: post.likes, liked: idx === -1 });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const { userId, text } = req.body;
        if (!text?.trim()) return res.json({ success: false });
        const db = await readDB();
        const post = db.posts.find(p => p.id === req.params.id);
        if (!post) return res.json({ success: false });
        const user = db.users.find(u => u.id === userId);
        if (!post.comments) post.comments = [];
        const comment = { id: uid(), userId, text: text.trim(), authorName: user?.displayName || user?.username || '?', authorAvatar: user?.avatar || '', createdAt: Date.now() };
        post.comments.push(comment);
        await writeDB(db);
        res.json({ success: true, comment });
    } catch(e) { res.json({ success: false }); }
});

// ===== USERS =====
app.get('/api/users/:id', async (req, res) => {
    try {
        const db = await readDB();
        const user = db.users.find(u => u.id === req.params.id || u.username === req.params.id);
        if (!user) return res.json({ success: false });
        const posts = db.posts.filter(p => p.userId === user.id).sort((a,b) => b.createdAt - a.createdAt);
        res.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatar: user.avatar, wallpaper: user.wallpaper, followers: user.followers || [], following: user.following || [] }, posts });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/users/:id/follow', async (req, res) => {
    try {
        const { userId } = req.body;
        const db = await readDB();
        const target = db.users.find(u => u.id === req.params.id);
        const me = db.users.find(u => u.id === userId);
        if (!target || !me || target.id === me.id) return res.json({ success: false });
        if (!target.followers) target.followers = [];
        if (!me.following) me.following = [];
        const idx = target.followers.indexOf(userId);
        if (idx === -1) { target.followers.push(userId); me.following.push(target.id); }
        else { target.followers.splice(idx, 1); me.following = me.following.filter(x => x !== target.id); }
        await writeDB(db);
        res.json({ success: true, following: idx === -1, followers: target.followers.length });
    } catch(e) { res.json({ success: false }); }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { userId, displayName, bio, avatar, wallpaper } = req.body;
        if (userId !== req.params.id) return res.json({ success: false });
        const db = await readDB();
        const user = db.users.find(u => u.id === userId);
        if (!user) return res.json({ success: false });
        if (displayName !== undefined) user.displayName = displayName;
        if (bio !== undefined) user.bio = bio;
        if (avatar !== undefined) user.avatar = avatar;
        if (wallpaper !== undefined) user.wallpaper = wallpaper;
        await writeDB(db);
        res.json({ success: true, user });
    } catch(e) { res.json({ success: false }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { userId, password } = req.body;
        if (userId !== req.params.id) return res.json({ success: false });
        const db = await readDB();
        const user = db.users.find(u => u.id === userId);
        if (!user || user.password !== password) return res.json({ success: false, error: 'Неверный пароль' });
        db.users = db.users.filter(u => u.id !== userId);
        db.posts = db.posts.filter(p => p.userId !== userId);
        db.users.forEach(u => {
            u.followers = (u.followers || []).filter(x => x !== userId);
            u.following = (u.following || []).filter(x => x !== userId);
        });
        await writeDB(db);
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.get('/api/users', async (req, res) => {
    try {
        const { search } = req.query;
        const db = await readDB();
        let users = db.users;
        if (search) {
            const q = search.toLowerCase();
            users = users.filter(u => u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q));
        }
        res.json(users.map(u => ({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, bio: u.bio, followers: (u.followers||[]).length })));
    } catch(e) { res.json([]); }
});

// ===== MESSAGES =====
app.get('/api/messages', async (req, res) => {
    try {
        const { userId, withId } = req.query;
        const db = await readDB();
        const msgs = db.messages.filter(m =>
            (m.from === userId && m.to === withId) ||
            (m.from === withId && m.to === userId)
        ).sort((a,b) => a.createdAt - b.createdAt);
        res.json(msgs);
    } catch(e) { res.json([]); }
});

app.post('/api/messages', async (req, res) => {
    try {
        const { from, to, text, sticker } = req.body;
        if (!from || !to || (!text?.trim() && !sticker)) return res.json({ success: false });
        const db = await readDB();
        const msg = { id: uid(), from, to, text: text?.trim() || '', sticker: sticker || '', createdAt: Date.now(), read: false };
        db.messages.push(msg);
        if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
        await writeDB(db);
        res.json({ success: true, msg });
    } catch(e) { res.json({ success: false }); }
});

app.get('/api/chats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = await readDB();
        const myMsgs = db.messages.filter(m => m.from === userId || m.to === userId);
        const chatIds = [...new Set(myMsgs.map(m => m.from === userId ? m.to : m.from))];
        const chats = chatIds.map(id => {
            const user = db.users.find(u => u.id === id);
            const msgs = myMsgs.filter(m => m.from === id || m.to === id).sort((a,b) => b.createdAt - a.createdAt);
            const last = msgs[0];
            const unread = msgs.filter(m => m.from === id && !m.read).length;
            return { id, username: user?.username || '?', displayName: user?.displayName || user?.username || '?', avatar: user?.avatar || '', lastMsg: last?.text || last?.sticker || '', lastTime: last?.createdAt || 0, unread };
        }).sort((a,b) => b.lastTime - a.lastTime);
        res.json(chats);
    } catch(e) { res.json([]); }
});

app.post('/api/messages/read', async (req, res) => {
    try {
        const { userId, fromId } = req.body;
        const db = await readDB();
        db.messages.forEach(m => { if (m.from === fromId && m.to === userId) m.read = true; });
        await writeDB(db);
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

// ===== GROUPS =====
app.get('/api/groups', async (req, res) => {
    try {
        const { userId } = req.query;
        const db = await readDB();
        let groups = db.groups || [];
        if (userId) groups = groups.filter(g => g.members.includes(userId));
        res.json(groups);
    } catch(e) { res.json([]); }
});

app.post('/api/groups', async (req, res) => {
    try {
        const { userId, name } = req.body;
        if (!userId || !name?.trim()) return res.json({ success: false });
        const db = await readDB();
        const group = { id: uid(), name: name.trim(), ownerId: userId, members: [userId], avatar: '', createdAt: Date.now() };
        db.groups.push(group);
        await writeDB(db);
        res.json({ success: true, group });
    } catch(e) { res.json({ success: false }); }
});

app.get('/api/groups/:id/messages', async (req, res) => {
    try {
        const db = await readDB();
        const msgs = (db.groupMessages || []).filter(m => m.groupId === req.params.id).sort((a,b) => a.createdAt - b.createdAt);
        res.json(msgs);
    } catch(e) { res.json([]); }
});

app.post('/api/groups/:id/messages', async (req, res) => {
    try {
        const { userId, text, sticker } = req.body;
        if (!userId || (!text?.trim() && !sticker)) return res.json({ success: false });
        const db = await readDB();
        const user = db.users.find(u => u.id === userId);
        const msg = { id: uid(), groupId: req.params.id, userId, text: text?.trim() || '', sticker: sticker || '', authorName: user?.displayName || user?.username || '?', authorAvatar: user?.avatar || '', createdAt: Date.now() };
        if (!db.groupMessages) db.groupMessages = [];
        db.groupMessages.push(msg);
        await writeDB(db);
        res.json({ success: true, msg });
    } catch(e) { res.json({ success: false }); }
});

// ===== PING =====
app.post('/api/ping', async (req, res) => {
    const { userId } = req.body;
    if (userId) {
        try {
            const db = await readDB();
            const user = db.users.find(u => u.id === userId);
            if (user) { user.lastSeen = Date.now(); _cache = db; }
        } catch(e) {}
    }
    res.json({ ok: true, time: Date.now() });
});

app.listen(PORT, () => console.log(`Угол запущен на порту ${PORT}`));
