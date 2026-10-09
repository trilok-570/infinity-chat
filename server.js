const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const dbPath = path.join(__dirname, 'first-commit-chat.db');
const db = new Database(dbPath);

const PORT = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET || 'first-commit-hackathon-secret';

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.originalMaxAge || 1000 * 60 * 60 * 24 * 7);
      db.prepare(
        `INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at`
      ).run(sid, JSON.stringify(sess), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + (sess.cookie?.originalMaxAge || 1000 * 60 * 60 * 24 * 7);
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

const sessionMiddleware = session({
  name: 'firstcommit.sid',
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  }
});

app.use(express.json({ limit: '15mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

const onlineUsers = new Map();

function ensureUserSession(req) {
  return req.session && req.session.userId ? Number(req.session.userId) : null;
}

function requireAuth(req, res, next) {
  const userId = ensureUserSession(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.userId = userId;
  next();
}

function saveAuthenticatedSession(req, res, user) {
  req.session.userId = user.id;
  req.session.save((error) => {
    if (error) {
      return res.status(500).json({ error: 'Could not save your login session. Please try again.' });
    }
    res.json({ user: publicUser(user, { includePrivate: true }) });
  });
}

function publicUser(user, { includePrivate = false } = {}) {
  const legacyVisibility = Boolean(user.profile_private ?? 1) ? 'private' : 'public';
  const fieldVisibility = {
    fullName: user.full_name_visibility || legacyVisibility,
    nickname: user.nickname_visibility || legacyVisibility,
    dateOfBirth: user.date_of_birth_visibility || legacyVisibility,
    gender: user.gender_visibility || legacyVisibility,
    profilePhoto: user.profile_photo_visibility || legacyVisibility
  };
  const canView = (field) => includePrivate || fieldVisibility[field] === 'public';
  const profilePrivate = fieldVisibility.fullName !== 'public';
  const result = {
    id: user.id,
    username: user.username,
    displayName: canView('fullName') ? user.display_name || user.username : user.username,
    nickname: canView('nickname') ? user.nickname || '' : '',
    profileImage: canView('profilePhoto') ? user.profile_image || null : null,
    profilePrivate,
    fieldVisibility
  };

  result.dateOfBirth = canView('dateOfBirth') && user.date_of_birth
      ? `${user.date_of_birth.slice(8, 10)}/${user.date_of_birth.slice(5, 7)}/${user.date_of_birth.slice(0, 4)}`
      : '';
  result.gender = canView('gender') ? user.gender || '' : '';
  result.customGender = canView('gender') ? user.custom_gender || '' : '';

  return result;
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function dateOnlyForOffset(date, timezoneOffsetMinutes) {
  const localTime = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  return `${String(localTime.getUTCFullYear()).padStart(4, '0')}-${String(localTime.getUTCMonth() + 1).padStart(2, '0')}-${String(localTime.getUTCDate()).padStart(2, '0')}`;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getOrCreateConversation(userA, userB) {
  const lower = [userA, userB].sort((a, b) => a - b);
  const existing = db
    .prepare(
      `SELECT * FROM conversations
       WHERE is_group = 0 AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))`
    )
    .get(lower[0], lower[1], lower[1], lower[0]);

  if (existing) {
    return existing;
  }

  const conversationId = crypto.randomUUID();
  const created = db
    .prepare(
      `INSERT INTO conversations (id, user_a, user_b, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(conversationId, lower[0], lower[1]);

  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
}

function getConversationById(conversationId) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
}

function getConversationSummary(userId, conversation, { revealLocked = false } = {}) {
  const isLocked = conversationIsLockedForUser(conversation.id, userId);
  const isArchived = conversation.is_archived === undefined
    ? Boolean(db.prepare(
      'SELECT 1 AS archived FROM conversation_archives WHERE user_id = ? AND conversation_id = ?'
    ).get(userId, conversation.id))
    : Boolean(conversation.is_archived);
  if (isLocked && !revealLocked) {
    return {
      id: conversation.id,
      otherUser: {
        username: 'locked',
        displayName: 'Locked chat',
        nickname: '',
        profileImage: null
      },
      lastMessage: null,
      updatedAt: conversation.updated_at,
      isLocked: true,
      isArchived,
      isGroup: Boolean(conversation.is_group),
      createdBy: conversation.created_by
    };
  }

  const isGroup = Boolean(conversation.is_group);
  const members = isGroup
    ? db.prepare(
      `SELECT u.id, u.username, u.display_name, u.nickname, u.profile_image,
             u.profile_private, u.full_name_visibility, u.nickname_visibility,
             u.date_of_birth_visibility, u.gender_visibility, u.profile_photo_visibility,
             u.date_of_birth, u.gender, u.custom_gender
      FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? ORDER BY cm.joined_at ASC`
    ).all(conversation.id).map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id) }))
    : [];
  const otherUserId = conversation.user_a === userId ? conversation.user_b : conversation.user_a;
  const otherUser = isGroup
    ? {
      id: conversation.id,
      username: conversation.group_name,
      displayName: conversation.group_name,
      nickname: '',
      profileImage: null,
      isGroup: true,
      members,
      memberCount: members.length
    }
    : publicUser(getUserById(otherUserId));
  const lastMessage = db
    .prepare(
      `SELECT m.*, sender.username AS sender_username
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at DESC, m.rowid DESC
       LIMIT 1`
    )
    .get(conversation.id);

  return {
    id: conversation.id,
    otherUser,
    lastMessage: lastMessage ? {
      id: lastMessage.id,
      text: lastMessage.text,
      sentAt: lastMessage.created_at,
      senderId: lastMessage.sender_id,
      senderUsername: lastMessage.sender_username,
      attachment: lastMessage.attachment_data ? {
        name: lastMessage.attachment_name,
        type: lastMessage.attachment_type
      } : null
    } : null,
    updatedAt: conversation.updated_at,
    isLocked,
    isArchived,
    isGroup,
    createdBy: conversation.created_by,
    unreadCount: db.prepare(
      'SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL'
    ).get(conversation.id, userId).count
  };
}

function getPresenceUserIds() {
  return Array.from(onlineUsers.keys()).sort((a, b) => a - b);
}

function broadcastPresence() {
  io.emit('presence:update', getPresenceUserIds());
}

function socketUserId(socket) {
  return socket.request && socket.request.session ? Number(socket.request.session.userId) : null;
}

function ensureConversationAccess(conversationId, userId) {
  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return null;
  }
  if (conversation.is_group) {
    if (!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(conversationId, userId)) return null;
  } else if (conversation.user_a !== userId && conversation.user_b !== userId) {
    return null;
  }
  return conversation;
}

function conversationIsLockedForUser(conversationId, userId) {
  return Boolean(db.prepare(
    'SELECT 1 FROM conversation_locks WHERE conversation_id = ? AND user_id = ?'
  ).get(conversationId, userId));
}

function hasUnlockedConversation(req, conversationId) {
  return Boolean(db.prepare(
    `SELECT 1 FROM conversation_unlocks
     WHERE user_id = ? AND conversation_id = ? AND session_id = ?`
  ).get(req.userId, conversationId, req.sessionID));
}

function sessionHasUnlockedConversation(sessionId, conversationId, userId) {
  return Boolean(db.prepare(
    `SELECT 1 FROM conversation_unlocks
     WHERE user_id = ? AND conversation_id = ? AND session_id = ?`
  ).get(userId, conversationId, sessionId));
}

function clearConversationAccess(userId, conversationId) {
  for (const socketId of onlineUsers.get(userId) || []) {
    io.sockets.sockets.get(socketId)?.leave(`conversation:${conversationId}`);
  }
}

function requireUnlockedConversation(req, res, conversationId) {
  if (conversationIsLockedForUser(conversationId, req.userId) && !hasUnlockedConversation(req, conversationId)) {
    res.status(423).json({ error: 'This chat is locked. Enter your chat PIN to unlock it.' });
    return false;
  }
  return true;
}

function chatPinCooldown(user) {
  const lockedUntil = Date.parse(user.chat_pin_locked_until || '');
  return Number.isFinite(lockedUntil) && lockedUntil > Date.now() ? lockedUntil : null;
}

function recordChatPinFailure(userId) {
  const user = getUserById(userId);
  const lockedUntil = Date.parse(user.chat_pin_locked_until || '');
  const currentFailures = Number.isFinite(lockedUntil) && lockedUntil <= Date.now()
    ? 0
    : Number(user.chat_pin_failures) || 0;
  const failures = currentFailures + 1;
  const nextLockUntil = failures >= 5
    ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
    : null;
  db.prepare(
    'UPDATE users SET chat_pin_failures = ?, chat_pin_locked_until = ? WHERE id = ?'
  ).run(failures, nextLockUntil, userId);
}

function clearChatPinFailures(userId) {
  db.prepare(
    'UPDATE users SET chat_pin_failures = 0, chat_pin_locked_until = NULL WHERE id = ?'
  ).run(userId);
}

function setUserOnline(socket, userId) {
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);
  socket.join(`user:${userId}`);
  broadcastPresence();
}

function setUserOffline(socket) {
  const userId = socketUserId(socket);
  if (!userId) {
    return;
  }
  const socketsForUser = onlineUsers.get(userId);
  if (!socketsForUser) {
    return;
  }
  socketsForUser.delete(socket.id);
  if (socketsForUser.size === 0) {
    onlineUsers.delete(userId);
  }
  broadcastPresence();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(conversation_id, user_id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(message_id, user_id, emoji),
    FOREIGN KEY(message_id) REFERENCES messages(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    group_name TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_a) REFERENCES users(id),
    FOREIGN KEY(user_b) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_archives (
    user_id INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, conversation_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attachment_data TEXT,
    attachment_name TEXT,
    attachment_type TEXT,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_locks (
    user_id INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, conversation_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_unlocks (
    user_id INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, conversation_id, session_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations(user_a, user_b);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id, conversation_id);
  CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
`);

const conversationColumns = new Set(db.prepare('PRAGMA table_info(conversations)').all().map((column) => column.name));
if (!conversationColumns.has('is_group')) db.exec('ALTER TABLE conversations ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0');
if (!conversationColumns.has('group_name')) db.exec('ALTER TABLE conversations ADD COLUMN group_name TEXT');
if (!conversationColumns.has('created_by')) db.exec('ALTER TABLE conversations ADD COLUMN created_by INTEGER');
const attachmentColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
if (!attachmentColumns.has('attachment_data')) db.exec('ALTER TABLE messages ADD COLUMN attachment_data TEXT');
if (!attachmentColumns.has('attachment_name')) db.exec('ALTER TABLE messages ADD COLUMN attachment_name TEXT');
if (!attachmentColumns.has('attachment_type')) db.exec('ALTER TABLE messages ADD COLUMN attachment_type TEXT');

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
if (!userColumns.has('display_name')) {
  db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.has('profile_image')) {
  db.exec('ALTER TABLE users ADD COLUMN profile_image TEXT');
}
if (!userColumns.has('date_of_birth')) {
  db.exec('ALTER TABLE users ADD COLUMN date_of_birth TEXT');
}
if (!userColumns.has('gender')) {
  db.exec('ALTER TABLE users ADD COLUMN gender TEXT');
}
if (!userColumns.has('nickname')) {
  db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.has('profile_private')) {
  db.exec('ALTER TABLE users ADD COLUMN profile_private INTEGER NOT NULL DEFAULT 1');
}
const profileVisibilityColumns = [
  'full_name_visibility',
  'nickname_visibility',
  'date_of_birth_visibility',
  'gender_visibility',
  'profile_photo_visibility'
];
const addedProfileVisibilityColumns = profileVisibilityColumns.filter((column) => !userColumns.has(column));
for (const column of addedProfileVisibilityColumns) {
  db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT 'private'`);
}
if (addedProfileVisibilityColumns.length) {
  const legacyVisibility = 'CASE WHEN COALESCE(profile_private, 1) = 1 THEN \'private\' ELSE \'public\' END';
  const assignments = addedProfileVisibilityColumns.map((column) => `${column} = ${legacyVisibility}`).join(', ');
  db.exec(`UPDATE users SET ${assignments}`);
}
if (!userColumns.has('custom_gender')) {
  db.exec("ALTER TABLE users ADD COLUMN custom_gender TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE users SET gender = 'custom', custom_gender = 'Transgender' WHERE gender = 'transgender'");
}
if (!userColumns.has('chat_pin_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN chat_pin_hash TEXT');
}
if (!userColumns.has('chat_pin_failures')) {
  db.exec('ALTER TABLE users ADD COLUMN chat_pin_failures INTEGER NOT NULL DEFAULT 0');
}
if (!userColumns.has('chat_pin_locked_until')) {
  db.exec('ALTER TABLE users ADD COLUMN chat_pin_locked_until TEXT');
}
const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
if (!messageColumns.has('read_at')) {
  db.exec('ALTER TABLE messages ADD COLUMN read_at TEXT');
}

const seededUsers = [
  { username: 'admin', password: 'admin123' },
  { username: 'maya', password: 'maya123' },
  { username: 'arjun', password: 'arjun123' },
  { username: 'sara', password: 'sara123' }
];

for (const user of seededUsers) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(user.username);
  if (!existing) {
    const passwordHash = bcrypt.hashSync(user.password, 10);
    db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).run(user.username, `${crypto.randomUUID()}@local.invalid`, passwordHash);
  }
}

if (db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count === 0) {
  const admin = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get('admin');
  const maya = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get('maya');
  if (admin && maya) {
    const conversation = getOrCreateConversation(admin.id, maya.id);
    const insertSampleMessage = db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, text, created_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    );
    const sampleMessages = [
      [maya.id, 'Hey! Are we still on for coffee this weekend?', '-18 minutes'],
      [admin.id, 'Absolutely! I found a cozy place near the park.', '-14 minutes'],
      [maya.id, 'That sounds perfect ☕ What time works for you?', '-9 minutes'],
      [admin.id, 'How about Saturday at 11? I’ll send you the location.', '-4 minutes']
    ];
    for (const [senderId, text, offset] of sampleMessages) {
      insertSampleMessage.run(crypto.randomUUID(), conversation.id, senderId, text, offset);
    }
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);
  }
}

app.get('/api/health', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true, database: 'ok', time: new Date().toISOString() });
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const cleanUsername = String(username).trim();
  const cleanPassword = String(password);

  if (cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }

  const hasStrongPassword = cleanPassword.length >= 8
    && /[a-z]/.test(cleanPassword)
    && /[A-Z]/.test(cleanPassword)
    && (cleanPassword.match(/\d/g) || []).length >= 2
    && /[^A-Za-z0-9]/.test(cleanPassword);
  if (!hasStrongPassword) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, 2 digits, and a special character.'
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  let user;
  try {
    user = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).run(cleanUsername, `${crypto.randomUUID()}@local.invalid`, passwordHash);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    throw error;
  }

  const savedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.lastInsertRowid);
  saveAuthenticatedSession(req, res, savedUser);
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).get(String(username).trim());

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(String(password), user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  saveAuthenticatedSession(req, res, user);
});

app.post('/api/logout', (req, res) => {
  const userId = ensureUserSession(req);
  if (userId) {
    const unlockedConversations = db.prepare(
      'SELECT conversation_id FROM conversation_unlocks WHERE user_id = ? AND session_id = ?'
    ).all(userId, req.sessionID);
    db.prepare(
      'DELETE FROM conversation_unlocks WHERE user_id = ? AND session_id = ?'
    ).run(userId, req.sessionID);
    for (const { conversation_id: conversationId } of unlockedConversations) {
      clearConversationAccess(userId, conversationId);
    }
  }
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: 'Could not log out. Please try again.' });
    }
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  const userId = ensureUserSession(req);
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = getUserById(userId);
  if (!user) {
    return res.status(401).json({ error: 'Session user not found' });
  }

  res.json({ user: publicUser(user, { includePrivate: true }), online: onlineUsers.has(userId) });
});

app.patch('/api/profile', requireAuth, (req, res) => {
  const displayName = typeof req.body?.fullName === 'string'
    ? req.body.fullName.trim()
    : typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
  const hasDateOfBirth = Object.prototype.hasOwnProperty.call(req.body || {}, 'dateOfBirth');
  const dateOfBirthInput = hasDateOfBirth && typeof req.body.dateOfBirth === 'string'
    ? req.body.dateOfBirth.trim()
    : null;
  const gender = typeof req.body?.gender === 'string' ? req.body.gender : '';
  const customGender = typeof req.body?.customGender === 'string' ? req.body.customGender.trim() : '';
  const profileImage = req.body?.profileImage;
  const fieldVisibility = req.body?.fieldVisibility;
  const visibilityFields = ['fullName', 'nickname', 'dateOfBirth', 'gender', 'profilePhoto'];
  if (!fieldVisibility || visibilityFields.some((field) => (
    !['public', 'private'].includes(fieldVisibility[field])
  ))) return res.status(400).json({ error: 'Choose Public or Private visibility for every profile field.' });

  if (!displayName || displayName.length > 40) {
    return res.status(400).json({ error: 'Full Name must be between 1 and 40 characters.' });
  }

  if (nickname.length > 32) {
    return res.status(400).json({ error: 'Nickname must be 32 characters or fewer.' });
  }

  let dateOfBirth = hasDateOfBirth
    ? dateOfBirthInput === '' ? null : dateOfBirthInput
    : getUserById(req.userId).date_of_birth;
  if (hasDateOfBirth && dateOfBirthInput === null) {
    return res.status(400).json({ error: 'Date of birth must use the YYYY-MM-DD format or be left empty.' });
  }
  if (dateOfBirth !== null) {
    if (!isValidDateOnly(dateOfBirth)) {
      return res.status(400).json({ error: 'Choose a valid calendar date for date of birth.' });
    }
    const offset = req.body?.dateOfBirthTimezoneOffsetMinutes;
    const timezoneOffsetMinutes = Number.isInteger(offset) && offset >= -840 && offset <= 840
      ? offset
      : new Date().getTimezoneOffset();
    if (dateOfBirth > dateOnlyForOffset(new Date(), timezoneOffsetMinutes)) {
      return res.status(400).json({ error: 'Date of birth cannot be in the future.' });
    }
  }

  const allowedGenders = new Set(['', 'male', 'female', 'non-binary', 'prefer-not-to-say', 'custom']);
  const normalizedGender = gender === 'transgender' ? 'custom' : gender;
  const normalizedCustomGender = gender === 'transgender' ? 'Transgender' : customGender;
  if (!allowedGenders.has(normalizedGender)) {
    return res.status(400).json({ error: 'Choose a valid gender option.' });
  }
  if (normalizedCustomGender.length > 40) {
    return res.status(400).json({ error: 'Custom gender must be 40 characters or fewer.' });
  }

  if (profileImage !== null && typeof profileImage !== 'string') {
    return res.status(400).json({ error: 'Profile photo must be a JPEG, PNG, or WebP image, or be removed.' });
  }

  if (typeof profileImage === 'string') {
    const match = profileImage.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) {
      return res.status(400).json({ error: 'Profile photo must be a JPEG, PNG, or WebP image.' });
    }

    const imageBytes = Buffer.from(match[2], 'base64');
    const isJpeg = match[1] === 'jpeg' && imageBytes.length >= 3
      && imageBytes[0] === 0xff
      && imageBytes[1] === 0xd8
      && imageBytes[2] === 0xff;
    const isPng = match[1] === 'png'
      && imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = match[1] === 'webp'
      && imageBytes.subarray(0, 4).toString() === 'RIFF'
      && imageBytes.subarray(8, 12).toString() === 'WEBP';
    if (!(isJpeg || isPng || isWebp) || imageBytes.length > 512 * 1024) {
      return res.status(400).json({ error: 'Profile photo must be a valid image smaller than 512 KB.' });
    }
  }

  const allPrivate = visibilityFields.every((field) => fieldVisibility[field] === 'private');
  db.prepare(
    `UPDATE users
     SET display_name = ?, nickname = ?, date_of_birth = ?, gender = ?, custom_gender = ?,
         profile_image = ?, profile_private = ?,
         full_name_visibility = ?, nickname_visibility = ?, date_of_birth_visibility = ?,
         gender_visibility = ?, profile_photo_visibility = ?
     WHERE id = ?`
  ).run(
    displayName,
    nickname,
    dateOfBirth,
    normalizedGender || null,
    normalizedGender === 'custom' ? normalizedCustomGender : '',
    profileImage,
    Number(allPrivate),
    fieldVisibility.fullName,
    fieldVisibility.nickname,
    fieldVisibility.dateOfBirth,
    fieldVisibility.gender,
    fieldVisibility.profilePhoto,
    req.userId
  );

  io.emit('profile-updated', { userId: req.userId });
  res.json({ user: publicUser(getUserById(req.userId), { includePrivate: true }) });
});

app.get('/api/users', requireAuth, (req, res) => {
  const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim().replace(/^@+/, '') : '';
  let users;
  if (searchTerm) {
    const escapedTerm = searchTerm.replace(/[\\%_]/g, '\\$&');
    users = db
      .prepare(
        `SELECT id, username, display_name, nickname, profile_image, date_of_birth, gender, custom_gender,
                profile_private, full_name_visibility, nickname_visibility, date_of_birth_visibility,
                gender_visibility, profile_photo_visibility, created_at
         FROM users
         WHERE id != ? AND (
           username LIKE ? ESCAPE '\\'
           OR (COALESCE(full_name_visibility, CASE WHEN COALESCE(profile_private, 1) = 1 THEN 'private' ELSE 'public' END) = 'public'
               AND display_name LIKE ? ESCAPE '\\')
           OR (COALESCE(nickname_visibility, CASE WHEN COALESCE(profile_private, 1) = 1 THEN 'private' ELSE 'public' END) = 'public'
               AND nickname LIKE ? ESCAPE '\\')
         )
         ORDER BY username COLLATE NOCASE ASC`
      )
      .all(req.userId, `%${escapedTerm}%`, `%${escapedTerm}%`, `%${escapedTerm}%`);
  } else {
    users = db
      .prepare(
        `SELECT id, username, display_name, nickname, profile_image, date_of_birth, gender, custom_gender,
                profile_private, full_name_visibility, nickname_visibility, date_of_birth_visibility,
                gender_visibility, profile_photo_visibility, created_at
         FROM users WHERE id != ? ORDER BY username COLLATE NOCASE ASC`
      )
      .all(req.userId);
  }

  res.json({ users: users.map((user) => ({ ...publicUser(user), online: onlineUsers.has(user.id) })) });
});

app.get('/api/users/:id/profile', requireAuth, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId === req.userId) {
    return res.status(400).json({ error: 'Choose another user to view their profile.' });
  }
  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ profile: { ...publicUser(user), online: onlineUsers.has(user.id) } });
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
             EXISTS (
               SELECT 1 FROM conversation_archives ca
               WHERE ca.user_id = ? AND ca.conversation_id = c.id
             ) AS is_archived
       FROM conversations c
       WHERE (c.is_group = 1 AND EXISTS (
                SELECT 1 FROM conversation_members cm
                WHERE cm.conversation_id = c.id AND cm.user_id = ?
              ))
          OR (c.is_group = 0 AND (c.user_a = ? OR c.user_b = ?))
       ORDER BY COALESCE(
         (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
         c.updated_at,
         c.created_at
       ) DESC,
       COALESCE(
         (SELECT m.rowid FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1),
         c.rowid
       ) DESC`
    )
    .all(req.userId, req.userId, req.userId, req.userId);

  const conversations = rows.map((conversation) => getConversationSummary(req.userId, conversation));
  res.json({ conversations });
});

app.post('/api/conversations/:id/archive', requireAuth, (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  if (typeof req.body?.isArchived !== 'boolean') {
    return res.status(400).json({ error: 'Choose whether to archive or restore this conversation.' });
  }
  const isArchived = req.body?.isArchived === true;
  if (isArchived) {
    db.prepare(
      'INSERT OR IGNORE INTO conversation_archives (user_id, conversation_id) VALUES (?, ?)'
    ).run(req.userId, req.params.id);
  } else {
    db.prepare(
      'DELETE FROM conversation_archives WHERE user_id = ? AND conversation_id = ?'
    ).run(req.userId, req.params.id);
  }
  const updatedConversation = db.prepare(
    `SELECT c.*,
            EXISTS (
              SELECT 1 FROM conversation_archives ca
              WHERE ca.user_id = ? AND ca.conversation_id = c.id
            ) AS is_archived
     FROM conversations c WHERE c.id = ?`
  ).get(req.userId, req.params.id);
  res.json({ conversation: getConversationSummary(req.userId, updatedConversation) });
});

app.get('/api/chat-security', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  res.json({ hasChatPin: Boolean(user?.chat_pin_hash) });
});

app.post('/api/chat-security/reset', requireAuth, (req, res) => {
  const unlockedConversations = db.prepare(
    'SELECT conversation_id FROM conversation_unlocks WHERE user_id = ? AND session_id = ?'
  ).all(req.userId, req.sessionID);
  db.prepare(
    'DELETE FROM conversation_unlocks WHERE user_id = ? AND session_id = ?'
  ).run(req.userId, req.sessionID);
  for (const { conversation_id: conversationId } of unlockedConversations) {
    clearConversationAccess(req.userId, conversationId);
  }
  res.json({ ok: true });
});

app.post('/api/conversations/:id/lock', requireAuth, async (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }

  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  if (!/^\d{6,12}$/.test(pin)) {
    return res.status(400).json({ error: 'Your chat PIN must be 6 to 12 digits.' });
  }

  const user = getUserById(req.userId);
  if (user.chat_pin_hash) {
    const lockedUntil = chatPinCooldown(user);
    if (lockedUntil) {
      const waitSeconds = Math.ceil((lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ error: `Too many incorrect PIN attempts. Try again in ${waitSeconds} seconds.` });
    }
    if (!await bcrypt.compare(pin, user.chat_pin_hash)) {
      recordChatPinFailure(req.userId);
      return res.status(401).json({ error: 'That chat PIN is incorrect.' });
    }
    clearChatPinFailures(req.userId);
  } else {
    const pinHash = await bcrypt.hash(pin, 10);
    db.prepare('UPDATE users SET chat_pin_hash = ? WHERE id = ?').run(pinHash, req.userId);
  }

  db.prepare(
    'INSERT OR IGNORE INTO conversation_locks (user_id, conversation_id) VALUES (?, ?)'
  ).run(req.userId, req.params.id);
  db.prepare('DELETE FROM conversation_unlocks WHERE user_id = ? AND conversation_id = ?')
    .run(req.userId, req.params.id);
  clearConversationAccess(req.userId, req.params.id);

  res.json({ ok: true });
});

app.post('/api/conversations/:id/unlock', requireAuth, async (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }

  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  const user = getUserById(req.userId);
  if (!user.chat_pin_hash) {
    return res.status(401).json({ error: 'No chat PIN is set for this account.' });
  }
  const lockedUntil = chatPinCooldown(user);
  if (lockedUntil) {
    const waitSeconds = Math.ceil((lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Too many incorrect PIN attempts. Try again in ${waitSeconds} seconds.` });
  }
  if (!await bcrypt.compare(pin, user.chat_pin_hash)) {
    recordChatPinFailure(req.userId);
    return res.status(401).json({ error: 'That chat PIN is incorrect.' });
  }
  clearChatPinFailures(req.userId);

  const locked = conversationIsLockedForUser(req.params.id, req.userId);
  if (!locked) {
    return res.status(400).json({ error: 'This chat is not locked.' });
  }

  db.prepare(
    'INSERT OR IGNORE INTO conversation_unlocks (user_id, conversation_id, session_id) VALUES (?, ?, ?)'
  ).run(req.userId, req.params.id, req.sessionID);
  res.json({ conversation: getConversationSummary(req.userId, conversation, { revealLocked: true }) });
});

app.post('/api/conversations/:id/relock', requireAuth, (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  db.prepare(
    'DELETE FROM conversation_unlocks WHERE user_id = ? AND conversation_id = ? AND session_id = ?'
  ).run(req.userId, req.params.id, req.sessionID);
  clearConversationAccess(req.userId, req.params.id);
  res.json({ ok: true });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const { userId: partnerId } = req.body || {};
  if (!partnerId) {
    return res.status(400).json({ error: 'Target user is required.' });
  }

  const targetId = Number(partnerId);
  if (!Number.isInteger(targetId) || targetId === req.userId) {
    return res.status(400).json({ error: 'Choose another user to talk to.' });
  }

  const targetUser = getUserById(targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const conversation = getOrCreateConversation(req.userId, targetId);
  const conversationSummary = getConversationSummary(req.userId, conversation);

  res.json({ conversation: conversationSummary });
});

app.post('/api/groups', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const requestedIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const memberIds = [...new Set([req.userId, ...requestedIds.map(Number)])];
  if (!name || name.length > 60) {
    return res.status(400).json({ error: 'Group name must be between 1 and 60 characters.' });
  }
  if (memberIds.length < 2 || memberIds.length > 50
    || memberIds.some((id) => !Number.isInteger(id) || !getUserById(id))) {
    return res.status(400).json({ error: 'Choose at least one other person to create a group.' });
  }

  const conversationId = crypto.randomUUID();
  const createGroup = db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations (id, user_a, user_b, is_group, group_name, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`
    ).run(conversationId, req.userId, req.userId, name, req.userId);
    const insertMember = db.prepare(
      'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)'
    );
    for (const memberId of memberIds) {
      insertMember.run(conversationId, memberId, memberId === req.userId ? 'admin' : 'member');
    }
  });
  createGroup();
  const conversation = getConversationById(conversationId);
  for (const memberId of memberIds) {
    io.to(`user:${memberId}`).emit('conversation-updated', { conversationId, groupCreated: true });
  }
  res.status(201).json({ conversation: getConversationSummary(req.userId, conversation) });
});

app.post('/api/conversations/:id/members', requireAuth, (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation || !conversation.is_group) {
    return res.status(404).json({ error: 'Group not found.' });
  }
  if (conversation.created_by !== req.userId) {
    return res.status(403).json({ error: 'Only the group creator can add people.' });
  }
  const memberIds = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(Number))];
  if (!memberIds.length || memberIds.length > 49
    || memberIds.some((id) => !Number.isInteger(id) || !getUserById(id))) {
    return res.status(400).json({ error: 'Choose valid people to add to the group.' });
  }
  const existingCount = db.prepare(
    'SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ?'
  ).get(conversation.id).count;
  const newIds = memberIds.filter((id) => !db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
  ).get(conversation.id, id));
  if (existingCount + newIds.length > 50) {
    return res.status(400).json({ error: 'Groups can have up to 50 members.' });
  }
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)'
  );
  for (const memberId of newIds) insertMember.run(conversation.id, memberId);
  const summary = getConversationSummary(req.userId, conversation);
  for (const memberId of newIds) {
    io.to(`user:${memberId}`).emit('conversation-updated', { conversationId: conversation.id, groupCreated: true });
  }
  res.json({ conversation: summary });
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  if (!requireUnlockedConversation(req, res, req.params.id)) return;

  const messages = db
    .prepare(
      `SELECT m.*, sender.username AS sender_username
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.rowid ASC`
    )
    .all(req.params.id);

  res.json({ messages: messages.map((message) => ({
    id: message.id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    senderUsername: message.sender_username,
    text: message.text,
    sentAt: message.created_at,
    readAt: message.read_at,
    attachment: message.attachment_data ? {
      data: message.attachment_data,
      name: message.attachment_name,
      type: message.attachment_type
    } : null,
    reactions: db.prepare(
      'SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted FROM message_reactions WHERE message_id = ? GROUP BY emoji'
    ).all(req.userId, message.id).map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      reacted: Boolean(reaction.reacted)
    }))
  })) });
});

app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
  const conversation = ensureConversationAccess(req.params.id, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  if (!requireUnlockedConversation(req, res, req.params.id)) return;

  const unreadMessages = db.prepare(
    `SELECT id, sender_id
     FROM messages
     WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
  ).all(req.params.id, req.userId);

  if (!unreadMessages.length) {
    return res.json({ messageIds: [], readAt: null });
  }

  const readAt = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE messages SET read_at = ?
       WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
    ).run(readAt, req.params.id, req.userId);
  });
  transaction();

  const messagesBySender = new Map();
  for (const message of unreadMessages) {
    if (!messagesBySender.has(message.sender_id)) {
      messagesBySender.set(message.sender_id, []);
    }
    messagesBySender.get(message.sender_id).push(message.id);
  }

  for (const [senderId, messageIds] of messagesBySender) {
    io.to(`user:${senderId}`).emit('messages-seen', {
      conversationId: req.params.id,
      messageIds,
      readAt
    });
  }

  res.json({ messageIds: unreadMessages.map((message) => message.id), readAt });
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { conversationId, text, attachment } = req.body || {};
  const safeText = String(text || '').trim();
  let attachmentData = null;
  let attachmentName = null;
  let attachmentType = null;

  if (!conversationId || (!safeText && !attachment)) {
    return res.status(400).json({ error: 'Write a message or attach a file.' });
  }
  if (attachment) {
    const declaredType = typeof attachment.type === 'string'
      ? attachment.type.split(';', 1)[0].trim().toLowerCase()
      : '';
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf', 'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'
    ]);
    if (typeof attachment.data !== 'string'
      || !allowedTypes.has(declaredType) || attachment.data.length > 11 * 1024 * 1024) {
      return res.status(400).json({ error: 'Unsupported file type or file exceeds the 8 MB limit.' });
    }
    const dataMatch = attachment.data.match(/^data:([A-Za-z0-9.+/-]+(?:;[A-Za-z0-9=.+-]+)*);base64,([A-Za-z0-9+/]+={0,2})$/);
    const dataUrlType = dataMatch?.[1].split(';', 1)[0].trim().toLowerCase();
    if (!dataMatch || dataUrlType !== declaredType
      || Buffer.from(dataMatch[2], 'base64').byteLength > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'Invalid attachment data or file exceeds the 8 MB limit.' });
    }
    attachmentData = attachment.data;
    attachmentName = typeof attachment.name === 'string'
      ? attachment.name.replace(/[\\/\0-\x1f]/g, '').slice(0, 180) || 'attachment'
      : 'attachment';
    attachmentType = declaredType;
  }

  const conversation = ensureConversationAccess(conversationId, req.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found.' });
  }
  if (!requireUnlockedConversation(req, res, conversationId)) return;

  const messageId = crypto.randomUUID();
  const insertMessage = db.prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_id, text, created_at, attachment_data, attachment_name, attachment_type
       ) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`
  );
  const updateConversation = db.prepare('UPDATE conversations SET updated_at = datetime(?) WHERE id = ?');
  const saveMessage = db.transaction(() => {
    insertMessage.run(messageId, conversationId, req.userId, safeText, attachmentData, attachmentName, attachmentType);
    const savedAt = db.prepare('SELECT created_at FROM messages WHERE id = ?').pluck().get(messageId);
    updateConversation.run(savedAt, conversationId);
  });
  saveMessage();

  const savedMessage = db
    .prepare(
      `SELECT m.*, sender.username AS sender_username
       FROM messages m
       JOIN users sender ON sender.id = m.sender_id
       WHERE m.id = ?`
    )
    .get(messageId);

  const payload = {
    id: savedMessage.id,
    conversationId: savedMessage.conversation_id,
    senderId: savedMessage.sender_id,
    senderUsername: savedMessage.sender_username,
    text: savedMessage.text,
    sentAt: savedMessage.created_at,
    readAt: savedMessage.read_at,
    attachment: savedMessage.attachment_data ? {
      data: savedMessage.attachment_data,
      name: savedMessage.attachment_name,
      type: savedMessage.attachment_type
    } : null,
    reactions: []
  };

  io.to(`conversation:${conversationId}`).emit('new-message', payload);

  const participantIds = conversation.is_group
    ? db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId).map((row) => row.user_id)
    : [conversation.user_a, conversation.user_b];
  for (const userId of participantIds) {
    const update = conversationIsLockedForUser(conversationId, userId)
      ? { conversationId, isLocked: true, senderId: req.userId }
      : { conversationId, lastMessage: payload, senderId: req.userId };
    io.to(`user:${userId}`).emit('conversation-updated', update);
  }

  res.status(201).json({ message: payload });
});

app.post('/api/messages/:id/reactions', requireAuth, (req, res) => {
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  const allowedEmoji = new Set(['❤️', '👍', '😂', '😮', '😢', '🔥', '👏']);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message || !ensureConversationAccess(message.conversation_id, req.userId)) {
    return res.status(404).json({ error: 'Message not found.' });
  }
  if (!requireUnlockedConversation(req, res, message.conversation_id)) return;
  if (!allowedEmoji.has(emoji)) {
    return res.status(400).json({ error: 'Choose a supported reaction.' });
  }
  const exists = db.prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(message.id, req.userId, emoji);
  if (exists) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .run(message.id, req.userId, emoji);
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
      .run(message.id, req.userId, emoji);
  }
  const reactions = db.prepare(
    'SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS reacted FROM message_reactions WHERE message_id = ? GROUP BY emoji'
  ).all(req.userId, message.id).map((reaction) => ({
    emoji: reaction.emoji,
    count: reaction.count,
    reacted: Boolean(reaction.reacted)
  }));
  io.to(`conversation:${message.conversation_id}`).emit('message-reactions-updated', {
    messageId: message.id,
    reactions
  });
  res.json({ reactions });
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message || !ensureConversationAccess(message.conversation_id, req.userId)) {
    return res.status(404).json({ error: 'Message not found.' });
  }
  if (!requireUnlockedConversation(req, res, message.conversation_id)) return;
  if (message.sender_id !== req.userId) {
    return res.status(403).json({ error: 'You can only delete your own messages.' });
  }
  db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(message.id);
  db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(message.conversation_id);
  io.to(`conversation:${message.conversation_id}`).emit('message-deleted', {
    messageId: message.id,
    conversationId: message.conversation_id
  });
  const participants = getConversationById(message.conversation_id);
  const participantIds = participants.is_group
    ? db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(message.conversation_id).map((row) => row.user_id)
    : [participants.user_a, participants.user_b];
  for (const userId of participantIds) {
    io.to(`user:${userId}`).emit('conversation-updated', {
      conversationId: message.conversation_id,
      messageDeleted: true
    });
  }
  res.json({ ok: true });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found. Check the request path and method.' });
});

app.get(/^(?!\/api\/).+$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  const isApiRequest = req.path.startsWith('/api/');
  const safeMessage = error.type === 'entity.parse.failed'
    ? 'Request body is not valid JSON.'
    : error.type === 'entity.too.large'
      ? 'Request body is too large.'
      : status >= 500
        ? 'The server could not complete this request. Please try again.'
        : 'The request could not be processed.';

  if (status >= 500) {
    console.error('Request failed:', {
      method: req.method,
      path: req.path,
      status,
      code: typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR'
    });
  }

  if (isApiRequest) {
    return res.status(status).json({ error: safeMessage });
  }
  return res.status(status).send(safeMessage);
});

io.on('connection', (socket) => {
  const sessionUserId = socket.request.session && socket.request.session.userId;
  if (!sessionUserId) {
    socket.disconnect();
    return;
  }

  const userId = Number(sessionUserId);
  socket.data.userId = userId;
  setUserOnline(socket, userId);

  socket.on('join-conversation', (conversationId) => {
    if (!conversationId || !ensureConversationAccess(conversationId, userId)) {
      return;
    }
    socket.request.session.reload((error) => {
      if (error || (conversationIsLockedForUser(conversationId, userId)
        && !sessionHasUnlockedConversation(socket.request.sessionID, conversationId, userId))) {
        return;
      }
      socket.join(`conversation:${conversationId}`);
    });
  });

  socket.on('leave-conversation', (conversationId) => {
    if (conversationId) {
      socket.leave(`conversation:${conversationId}`);
    }
  });

  socket.on('typing', (conversationId) => {
    if (!conversationId || !ensureConversationAccess(conversationId, userId)) {
      return;
    }
    if (conversationIsLockedForUser(conversationId, userId)
      && !sessionHasUnlockedConversation(socket.request.sessionID, conversationId, userId)) {
      return;
    }
    socket.to(`conversation:${conversationId}`).emit('typing', {
      conversationId,
      userId,
      username: getUserById(userId)?.username || 'Unknown'
    });
  });

  socket.on('stop-typing', (conversationId) => {
    if (!conversationId || !ensureConversationAccess(conversationId, userId)) {
      return;
    }
    if (conversationIsLockedForUser(conversationId, userId)
      && !sessionHasUnlockedConversation(socket.request.sessionID, conversationId, userId)) {
      return;
    }
    socket.to(`conversation:${conversationId}`).emit('stop-typing', {
      conversationId,
      userId
    });
  });

  socket.on('disconnect', () => {
    setUserOffline(socket);
  });
});

server.listen(PORT, () => {
  console.log(`INFINITY CHAT running on http://localhost:${PORT}`);
});
