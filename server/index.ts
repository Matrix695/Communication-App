import express from 'express'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { z } from 'zod'

const port = Number(process.env.PORT ?? 3001)
const secret = process.env.JWT_SECRET ?? randomBytes(32).toString('hex')
const db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), 'gather.sqlite'))
db.pragma('journal_mode = WAL')
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('dm','group')), name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversation_members (conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_read_at TEXT, PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, sender_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id,id DESC);
`)

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { maxHttpBufferSize: 5e6, cors: { origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', credentials: true } })
app.use(helmet({ crossOriginEmbedderPolicy: false }))
app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }))

type SessionUser = { id: number; name: string; email: string }
const tokenFor = (user: SessionUser) => jwt.sign(user, secret, { expiresIn: '7d' })
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 }
function session(req: express.Request): SessionUser | null {
  try { return jwt.verify(req.cookies?.gather_session, secret) as SessionUser } catch { return null }
}
function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = session(req)
  if (!user) { res.status(401).json({ error: 'Please sign in to continue.' }); return }
  res.locals.user = user
  next()
}

const credentials = z.object({ email: z.string().email().max(254).transform((email) => email.trim().toLowerCase()), password: z.string().min(8).max(128) })
app.post('/api/auth/register', async (req, res) => {
  const parsed = credentials.extend({ name: z.string().trim().min(2).max(60) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Enter a valid name, email, and password of at least 8 characters.' }); return }
  const { email, password, name } = parsed.data
  try {
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, await bcrypt.hash(password, 12))
    const user = { id: Number(result.lastInsertRowid), name, email }
    res.cookie('gather_session', tokenFor(user), cookieOptions).json({ user })
  } catch { res.status(409).json({ error: 'An account with that email already exists.' }) }
})
app.post('/api/auth/login', async (req, res) => {
  const parsed = credentials.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Enter a valid email and password.' }); return }
  const row = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(parsed.data.email) as (SessionUser & { password_hash: string }) | undefined
  if (!row || !await bcrypt.compare(parsed.data.password, row.password_hash)) { res.status(401).json({ error: 'Email or password is incorrect.' }); return }
  const user = { id: row.id, name: row.name, email: row.email }
  res.cookie('gather_session', tokenFor(user), cookieOptions).json({ user })
})
app.get('/api/auth/me', requireUser, (_req, res) => res.json({ user: res.locals.user }))
app.post('/api/auth/logout', (_req, res) => res.clearCookie('gather_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }).json({ ok: true }))
app.get('/api/health', (_req, res) => res.json({ ok: true }))

const isMember = (conversationId: number, userId: number) => Boolean(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId))
const publicMessage = (id: number) => db.prepare('SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId, u.name AS senderName, m.body, m.created_at AS createdAt FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(id)
app.get('/api/users', requireUser, (req, res) => {
  const user = res.locals.user as SessionUser
  const query = String(req.query.q ?? '').trim().slice(0, 80)
  if (query.length < 2) { res.json({ users: [] }); return }
  const users = db.prepare('SELECT id, name, email FROM users WHERE id != ? AND (name LIKE ? OR email LIKE ?) ORDER BY name LIMIT 20').all(user.id, `%${query}%`, `%${query}%`)
  res.json({ users })
})
app.get('/api/conversations', requireUser, (req, res) => {
  const user = res.locals.user as SessionUser
  const rows = db.prepare(`SELECT c.id, c.kind, c.name, c.created_at AS createdAt,
    (SELECT m.body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS lastMessage,
    (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS lastMessageAt,
    (SELECT COUNT(*) FROM messages m JOIN conversation_members mine ON mine.conversation_id=m.conversation_id AND mine.user_id=? WHERE m.conversation_id=c.id AND m.sender_id != ? AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)) AS unread,
    (SELECT json_group_array(json_object('id',u.id,'name',u.name,'email',u.email)) FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=c.id AND u.id != ?) AS peers
    FROM conversations c JOIN conversation_members mine ON mine.conversation_id=c.id AND mine.user_id=?
    ORDER BY COALESCE(lastMessageAt,c.created_at) DESC`).all(user.id,user.id,user.id,user.id)
  res.json({ conversations: rows.map((row) => ({ ...row, peers: JSON.parse(String(row.peers || '[]')) })) })
})
app.post('/api/conversations', requireUser, (req, res) => {
  const user = res.locals.user as SessionUser
  const parsed = z.object({ userId: z.number().int().positive() }).safeParse(req.body)
  if (!parsed.success || parsed.data.userId === user.id || !db.prepare('SELECT 1 FROM users WHERE id=?').get(parsed.data.userId)) { res.status(400).json({ error: 'Choose a valid person to message.' }); return }
  const existing = db.prepare(`SELECT c.id FROM conversations c WHERE c.kind='dm' AND
    EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=c.id AND user_id=?) AND
    EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=c.id AND user_id=?) AND
    (SELECT COUNT(*) FROM conversation_members WHERE conversation_id=c.id)=2 LIMIT 1`).get(user.id, parsed.data.userId) as { id: number } | undefined
  if (existing) { res.json({ conversationId: existing.id }); return }
  const create = db.transaction(() => {
    const result = db.prepare("INSERT INTO conversations(kind) VALUES ('dm')").run()
    const id = Number(result.lastInsertRowid)
    const add = db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)')
    add.run(id,user.id); add.run(id,parsed.data.userId)
    return id
  })
  res.status(201).json({ conversationId: create() })
})
app.get('/api/conversations/:id/messages', requireUser, (req, res) => {
  const user = res.locals.user as SessionUser
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || !isMember(id,user.id)) { res.status(404).json({ error: 'Conversation not found.' }); return }
  const messages = db.prepare(`SELECT m.id,m.conversation_id AS conversationId,m.sender_id AS senderId,u.name AS senderName,m.body,m.created_at AS createdAt FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 100`).all(id).reverse()
  db.prepare('UPDATE conversation_members SET last_read_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND user_id=?').run(id,user.id)
  res.json({ messages })
})
app.post('/api/conversations/:id/messages', requireUser, (req, res) => {
  const user = res.locals.user as SessionUser
  const id = Number(req.params.id)
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body)
  if (!Number.isSafeInteger(id) || !isMember(id,user.id)) { res.status(404).json({ error: 'Conversation not found.' }); return }
  if (!parsed.success) { res.status(400).json({ error: 'Messages must contain 1 to 4,000 characters.' }); return }
  const result = db.prepare('INSERT INTO messages(conversation_id,sender_id,body) VALUES (?,?,?)').run(id,user.id,parsed.data.body)
  db.prepare('UPDATE conversation_members SET last_read_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND user_id=?').run(id,user.id)
  const message = publicMessage(Number(result.lastInsertRowid))
  io.to(`conversation:${id}`).emit('message:new', message)
  res.status(201).json({ message })
})

const socketUsers = new Map<string, SessionUser>()
const roomPattern = /^[a-zA-Z0-9_-]{3,64}$/
io.use((socket, next) => {
  try {
    const cookies = Object.fromEntries((socket.handshake.headers.cookie ?? '').split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)))
    socketUsers.set(socket.id, jwt.verify(decodeURIComponent(cookies.gather_session ?? ''), secret) as SessionUser)
    next()
  } catch { next(new Error('Authentication required')) }
})
io.on('connection', (socket) => {
  const user = socketUsers.get(socket.id)!
  void socket.join(`user:${user.id}`)
  socket.on('conversation:join', ({ conversationId } = {}) => {
    const id = Number(conversationId)
    if (Number.isSafeInteger(id) && isMember(id,user.id)) void socket.join(`conversation:${id}`)
  })
  socket.on('conversation:leave', ({ conversationId } = {}) => {
    const id = Number(conversationId)
    if (Number.isSafeInteger(id)) void socket.leave(`conversation:${id}`)
  })
  const activeRooms = new Set<string>()
  const validRoom = (roomId: unknown): roomId is string => typeof roomId === 'string' && roomPattern.test(roomId) && activeRooms.has(roomId)
  socket.on('room:join', ({ roomId } = {}) => {
    if (typeof roomId !== 'string' || !roomPattern.test(roomId)) { socket.emit('room:error', { error: 'That room code is not valid.' }); return }
    if (activeRooms.has(roomId)) return
    const peers = [...(io.sockets.adapter.rooms.get(roomId) ?? [])].filter((id) => id !== socket.id).map((id) => ({ id: socketUsers.get(id)?.id ?? 0, name: socketUsers.get(id)?.name ?? 'Guest', socketId: id }))
    activeRooms.add(roomId)
    void socket.join(roomId)
    socket.emit('room:peers', peers)
    socket.to(roomId).emit('room:peer-joined', { id: user.id, name: user.name, socketId: socket.id })
  })
  socket.on('room:leave', ({ roomId } = {}) => {
    if (!validRoom(roomId)) return
    activeRooms.delete(roomId)
    void socket.leave(roomId)
    socket.to(roomId).emit('room:peer-left', { socketId: socket.id })
  })
  socket.on('room:signal', ({ roomId, target, signal } = {}) => {
    if (!validRoom(roomId) || typeof target !== 'string' || !io.sockets.adapter.rooms.get(roomId)?.has(target)) return
    io.to(target).emit('room:signal', { from: socket.id, signal })
  })
  socket.on('room:chat', ({ roomId, text } = {}) => {
    if (!validRoom(roomId) || typeof text !== 'string' || !text.trim() || text.length > 1000) return
    io.to(roomId).emit('room:chat', { id: randomBytes(12).toString('hex'), text: text.trim(), name: user.name, userId: user.id, time: Date.now() })
  })
  socket.on('room:file', (payload = {}) => {
    const { roomId, name, type, size, data } = payload
    if (!validRoom(roomId) || typeof name !== 'string' || name.length > 180 || typeof size !== 'number' || size > 3 * 1024 * 1024 || typeof data !== 'string' || data.length > 4_200_000 || !/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(String(type))) return
    io.to(roomId).emit('room:file', { id: randomBytes(12).toString('hex'), name, type, size, data, sender: user.name, time: Date.now() })
  })
  socket.on('room:stroke', ({ roomId, stroke } = {}) => {
    if (!validRoom(roomId) || !stroke || typeof stroke.id !== 'string' || stroke.id.length > 80 || !Array.isArray(stroke.points) || stroke.points.length > 2000 || !stroke.points.every((point: { x?: number; y?: number }) => Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x! >= 0 && point.x! <= 1 && point.y! >= 0 && point.y! <= 1)) return
    socket.to(roomId).emit('room:stroke', stroke)
  })
  socket.on('room:board-clear', ({ roomId } = {}) => { if (validRoom(roomId)) socket.to(roomId).emit('room:board-clear') })
  socket.on('disconnect', () => {
    socketUsers.delete(socket.id)
    for (const roomId of activeRooms) socket.to(roomId).emit('room:peer-left', { socketId: socket.id })
  })
})

httpServer.listen(port, () => console.log(`Gather server listening on http://localhost:${port}`))
