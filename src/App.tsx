import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, CheckCheck, Copy, Eye, EyeOff, FileText, Files,
  Headphones, Link2, LogOut, MessageCircle, Mic, MicOff, MonitorUp, MoreHorizontal, Moon,
  Paperclip, Pencil, Plus, Search, Send, ShieldCheck, Smile, Sparkles, Sun, Users, Video, VideoOff,
  X, Phone, UserRoundPlus,
} from 'lucide-react'
import './App.css'

type User = { id: number; name: string; email: string }
type Participant = { id: number; name: string; socketId: string }
type ChatMessage = { id: string; text: string; name: string; userId: number; time: number }
type SharedFile = { id: string; name: string; type: string; size: number; data: string; sender: string; time: number }
type Point = { x: number; y: number }
type Stroke = { id: string; color: string; points: Point[] }
type RoomSignal = { from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }
type DirectAttachment = { id: number; name: string; size: number }
type DirectMessage = { id: number; conversationId: number; senderId: number; senderName: string; body: string; createdAt: string; attachment?: DirectAttachment | null }
type Conversation = { id: number; kind: 'dm' | 'group'; name: string | null; peers: User[]; lastMessage: string | null; lastMessageAt: string | null; unread: number }

const ICE_SERVERS: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const FILE_LIMIT = 3 * 1024 * 1024

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('Unable to read file.'))
    reader.onerror = () => reject(new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init })
  const data = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.')
  return data
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const emojiCategories = [
  { name: 'Smileys', items: [['😀', 'grinning happy'], ['😃', 'smiling happy'], ['😄', 'smile happy'], ['😁', 'beaming grin'], ['😆', 'laughing'], ['😅', 'sweat smile'], ['🤣', 'rolling laughing'], ['😂', 'tears joy laughing'], ['🙂', 'slightly smiling'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blushing smile'], ['😇', 'angel halo'], ['🥰', 'hearts love'], ['😍', 'heart eyes love'], ['🤩', 'star struck excited'], ['😘', 'kiss love'], ['😋', 'yum delicious'], ['😛', 'tongue playful'], ['🤗', 'hug'], ['🤔', 'thinking'], ['🤫', 'shush quiet'], ['😎', 'cool sunglasses'], ['🥳', 'celebration party'], ['😭', 'crying sad'], ['😤', 'frustrated'], ['🤯', 'mind blown'], ['🥹', 'teary touched'], ['😴', 'sleeping tired'], ['🤔', 'wondering'] ] },
  { name: 'Gestures', items: [['👋', 'wave hello'], ['🤚', 'raised hand'], ['✋', 'hand stop'], ['🖐️', 'open hand'], ['👌', 'okay'], ['🤌', 'pinched fingers'], ['✌️', 'peace victory'], ['🤞', 'crossed fingers luck'], ['🤟', 'love you'], ['🤘', 'rock on'], ['🤙', 'call me'], ['👈', 'point left'], ['👉', 'point right'], ['👆', 'point up'], ['👇', 'point down'], ['☝️', 'index up'], ['👍', 'thumbs up like'], ['👎', 'thumbs down dislike'], ['✊', 'fist'], ['👏', 'clap applause'], ['🙌', 'celebration praise'], ['🫶', 'heart hands love'], ['🙏', 'please thanks pray'], ['💪', 'strong muscle'], ['🫡', 'salute respect'], ['🤝', 'handshake deal'], ['👐', 'open hands'], ['🤲', 'palms up'] ] },
  { name: 'Hearts', items: [['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['🩵', 'light blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'], ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts love'], ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'], ['💖', 'sparkling heart'], ['💘', 'cupid arrow'], ['💝', 'heart gift'], ['💟', 'heart decoration'], ['♥️', 'card heart'], ['💌', 'love letter'], ['💋', 'kiss'], ['💐', 'bouquet flowers'], ['🌷', 'tulip flower'], ['✨', 'sparkles'], ['💫', 'dizzy star'], ['⭐', 'star'], ['🌟', 'glowing star'], ['🔥', 'fire hot'] ] },
  { name: 'Animals', items: [['🐶', 'dog puppy'], ['🐱', 'cat kitten'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit bunny'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'], ['🦋', 'butterfly'], ['🐝', 'bee'], ['🐢', 'turtle'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🦄', 'unicorn'], ['🐙', 'octopus'], ['🦖', 'dinosaur'], ['🐾', 'paw prints'], ['🌈', 'rainbow'], ['🌻', 'sunflower'], ['🌿', 'herb leaf'] ] },
  { name: 'Food', items: [['🍎', 'apple fruit'], ['🍊', 'orange fruit'], ['🍋', 'lemon'], ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🫐', 'blueberries'], ['🍒', 'cherries'], ['🍑', 'peach'], ['🥑', 'avocado'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🍟', 'fries'], ['🌮', 'taco'], ['🍜', 'noodles ramen'], ['🍣', 'sushi'], ['🍩', 'doughnut'], ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🍰', 'cake'], ['🍫', 'chocolate'], ['🍿', 'popcorn'], ['☕', 'coffee'], ['🧋', 'bubble tea'], ['🍵', 'tea'], ['🥂', 'cheers toast'], ['🍷', 'wine'], ['🍺', 'beer'], ['🧁', 'cupcake'], ['🍯', 'honey'] ] },
  { name: 'Activities', items: [['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'american football'], ['⚾', 'baseball'], ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🎱', 'billiards'], ['🏓', 'ping pong'], ['🏸', 'badminton'], ['🥊', 'boxing'], ['🏆', 'trophy win'], ['🥇', 'gold medal first'], ['🎯', 'target goal'], ['🎮', 'video game'], ['🎲', 'dice game'], ['🎸', 'guitar music'], ['🎹', 'piano music'], ['🎤', 'microphone singing'], ['🎧', 'headphones music'], ['🎬', 'movie'], ['🎨', 'art palette'], ['🧩', 'puzzle'], ['🎉', 'party popper celebration'], ['🎊', 'confetti celebration'], ['🎁', 'gift present'], ['🪩', 'disco'], ['💃', 'dancing'], ['🕺', 'dancer'], ['🧘', 'meditation'], ['🚴', 'cycling'] ] },
  { name: 'Travel', items: [['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'], ['🚆', 'train'], ['✈️', 'airplane flight'], ['🚀', 'rocket space'], ['🚲', 'bicycle'], ['🛴', 'scooter'], ['⛵', 'sailboat'], ['🚢', 'ship'], ['🏖️', 'beach'], ['🏝️', 'island'], ['🏕️', 'camping'], ['🏠', 'house home'], ['🏙️', 'city'], ['🌇', 'sunset city'], ['🌃', 'night city'], ['🌅', 'sunrise'], ['🌄', 'mountain sunrise'], ['⛰️', 'mountain'], ['🌋', 'volcano'], ['🗽', 'statue liberty'], ['🗼', 'tokyo tower'], ['🧳', 'luggage travel'], ['🗺️', 'map'], ['🧭', 'compass'], ['🌍', 'earth world'], ['🌙', 'moon night'], ['☀️', 'sun sunny'], ['❄️', 'snow cold'] ] },
  { name: 'Objects', items: [['💡', 'light bulb idea'], ['📱', 'phone mobile'], ['💻', 'laptop computer'], ['⌚', 'watch time'], ['📷', 'camera photo'], ['🔋', 'battery'], ['🔑', 'key'], ['🔒', 'lock secure'], ['🔔', 'bell notification'], ['📌', 'pin'], ['✏️', 'pencil write'], ['📝', 'memo note'], ['📚', 'books reading'], ['📦', 'package box'], ['🛍️', 'shopping bags'], ['💰', 'money bag'], ['💎', 'gem diamond'], ['🎈', 'balloon'], ['🕯️', 'candle'], ['🧸', 'teddy bear'], ['🪄', 'magic wand'], ['🧠', 'brain'], ['🫧', 'bubbles'], ['✅', 'check done'], ['❌', 'cross no'], ['💯', 'hundred perfect'], ['💬', 'speech bubble chat'], ['📣', 'megaphone announcement'], ['📅', 'calendar date'], ['❤️‍🔥', 'heart on fire'] ] },
] as const

function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [categoryIndex, setCategoryIndex] = useState(0)
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const visibleEmojis = query
    ? emojiCategories.flatMap((category) => category.items).filter(([emoji, keywords]) => emoji.includes(query) || keywords.includes(query))
    : emojiCategories[categoryIndex].items

  return <div className="emoji-picker" role="dialog" aria-label="Emoji picker"><div className="emoji-picker-heading"><b>Choose an emoji</b><button type="button" onClick={onClose} aria-label="Close emoji picker"><X size={16} /></button></div><label className="emoji-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search emojis" aria-label="Search emojis" /></label>{!query && <div className="emoji-categories" role="tablist" aria-label="Emoji categories">{emojiCategories.map((category, index) => <button type="button" key={category.name} role="tab" aria-selected={categoryIndex === index} className={categoryIndex === index ? 'selected' : ''} onClick={() => setCategoryIndex(index)}>{category.name}</button>)}</div>}<div className="emoji-grid">{visibleEmojis.map(([emoji, keywords], index) => <button type="button" className="emoji-option" key={`${emoji}-${index}`} title={keywords} aria-label={`Insert ${keywords} emoji`} onClick={() => onSelect(emoji)}>{emoji}</button>)}{visibleEmojis.length === 0 && <span className="emoji-no-results">No emojis found</span>}</div></div>
}

function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  const nextTheme = theme === 'light' ? 'dark' : 'light'
  return <button type="button" className="theme-toggle" onClick={onToggle} title={`Switch to ${nextTheme} mode`} aria-label={`Switch to ${nextTheme} mode`}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('gather-theme') === 'dark' ? 'dark' : 'light')
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [roomError, setRoomError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('gather-theme', theme)
  }, [theme])

  useEffect(() => {
    request<{ user: User }>('/api/auth/me')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true))
  }, [])

  useEffect(() => {
    const invitedRoom = new URLSearchParams(window.location.search).get('room')
    if (invitedRoom && /^[a-zA-Z0-9_-]{3,64}$/.test(invitedRoom)) setJoinCode(invitedRoom)
  }, [])

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await request<{ user: User }>(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
        }),
      })
      setUser(response.user)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = async () => {
    await request('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setRoomId('')
  }

  const createRoom = async () => {
    setRoomError('')
    try {
      const room = await request<{ roomId: string; inviteCode: string; inviteLink: string }>('/api/rooms', { method: 'POST' })
      setInviteLink(room.inviteLink)
      setInviteCode(room.inviteCode)
      setRoomId(room.roomId)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Unable to create the meeting.')
    }
  }
  const joinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = joinCode.trim()
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(code)) { setRoomError('Enter a valid room code.'); return }
    if (!/^[a-fA-F0-9]{12}$/.test(joinInviteCode.trim())) { setRoomError('Enter the 12-character meeting invite code.'); return }
    setRoomError('')
    try {
      await request('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: code, inviteCode: joinInviteCode.trim() }),
      })
      setInviteLink(`${window.location.origin}/?room=${encodeURIComponent(code)}`)
      setInviteCode(joinInviteCode.trim().toUpperCase())
      setRoomId(code)
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Unable to join the meeting.')
    }
  }

  if (!authReady) return <div className="loading-screen"><span className="brand-mark"><Sparkles size={20} /></span></div>
  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-visual">
          <div className="auth-brand"><span className="brand-mark"><Sparkles size={20} /></span> gather</div>
          <div className="visual-copy">
            <span className="eyebrow">GOOD WORK, TOGETHER</span>
            <h1>Make room<br />for great ideas.</h1>
            <p>Meet, make, and move projects forward — all in one shared space.</p>
            <div className="visual-people"><span className="avatar avatar-lilac">J</span><span className="avatar avatar-yellow">M</span><span className="avatar avatar-coral">A</span><span className="avatar avatar-blue">K</span><span className="people-label">Your team is waiting</span></div>
          </div>
          <div className="visual-foot"><ShieldCheck size={15} /> Private by design. Better together.</div>
          <div className="decor decor-one" /><div className="decor decor-two" />
        </section>
        <section className="auth-form-wrap">
          <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} />
          <form className="auth-form" onSubmit={authenticate}>
            <span className="eyebrow">YOUR SPACE IS READY</span>
            <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="form-subtitle">{authMode === 'login' ? 'Sign in to pick up where you left off.' : 'Start bringing your team a little closer.'}</p>
            {authMode === 'register' && <label>Your name<input name="name" placeholder="Alex Morgan" autoComplete="name" minLength={2} maxLength={60} required /></label>}
            <label>Email address<input name="email" type="email" placeholder="you@company.com" autoComplete="email" maxLength={254} required /></label>
            <label>Password<div className="password-input-wrap"><input name="password" type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={128} required /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            {authError && <div className="inline-error" role="alert">{authError}</div>}
            <button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? 'One moment…' : authMode === 'login' ? 'Sign in' : 'Create account'}<ArrowUpRight size={17} /></button>
            <div className="auth-switch"><span>{authMode === 'login' ? 'New to Gather?' : 'Already have an account?'}</span><button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Create account' : 'Sign in'}</button></div>
            <div className="auth-note"><ShieldCheck size={15} /> Your conversations stay yours.</div>
          </form>
          <span className="auth-copyright">© 2026 Gather · Made for people doing good things.</span>
        </section>
      </main>
    )
  }

  if (roomId) return <MeetingRoom user={user} roomId={roomId} inviteCode={inviteCode} inviteLink={inviteLink} theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} onLeave={() => setRoomId('')} onSignOut={signOut} />

  return <Messenger user={user} onSignOut={signOut} onStartCall={createRoom} onJoinRoom={joinRoom} joinCode={joinCode} setJoinCode={setJoinCode} joinInviteCode={joinInviteCode} setJoinInviteCode={setJoinInviteCode} roomError={roomError} theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} />
}

function Messenger({ user, onSignOut, onStartCall, onJoinRoom, joinCode, setJoinCode, joinInviteCode, setJoinInviteCode, roomError, theme, onToggleTheme }: {
  user: User
  onSignOut: () => void
  onStartCall: () => void
  onJoinRoom: (event: FormEvent<HTMLFormElement>) => void
  joinCode: string
  setJoinCode: (code: string) => void
  joinInviteCode: string
  setJoinInviteCode: (code: string) => void
  roomError: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeConversation = conversations.find((item) => item.id === activeId) ?? null
  const activePeer = activeConversation?.peers[0]

  const refreshConversations = useCallback(async () => {
    const result = await request<{ conversations: Conversation[] }>('/api/conversations')
    setConversations(result.conversations)
  }, [])

  useEffect(() => {
    const nextSocket = io({ withCredentials: true, reconnection: true, reconnectionAttempts: 5 })
    setSocket(nextSocket)
    nextSocket.on('message:new', (incoming: DirectMessage) => {
      if (incoming.conversationId === activeId) setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming])
      void refreshConversations()
    })
    return () => { nextSocket.disconnect() }
  }, [activeId, refreshConversations])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    request<{ conversations: Conversation[] }>('/api/conversations')
      .then(({ conversations: items }) => { if (!cancelled) setConversations(items) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load chats.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const term = query.trim()
    if (term.length < 2) { setContacts([]); return }
    const timer = window.setTimeout(() => {
      request<{ users: User[] }>(`/api/users?q=${encodeURIComponent(term)}`)
        .then(({ users }) => { if (!cancelled) setContacts(users) })
        .catch(() => { if (!cancelled) setContacts([]) })
    }, 220)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (activeId === null) { setMessages([]); return }
    socket?.emit('conversation:join', { conversationId: activeId })
    let cancelled = false
    request<{ messages: DirectMessage[] }>(`/api/conversations/${activeId}/messages`)
      .then(({ messages: items }) => { if (!cancelled) setMessages(items) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load messages.') })
    return () => { cancelled = true; socket?.emit('conversation:leave', { conversationId: activeId }) }
  }, [activeId, socket])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const openConversation = (id: number) => {
    setError('')
    setActiveId(id)
    setMobileChatOpen(true)
    setQuery('')
  }

  const startConversation = async (peer: User) => {
    setBusy(true)
    setError('')
    try {
      const result = await request<{ conversationId: number }>('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: peer.id }),
      })
      await refreshConversations()
      openConversation(result.conversationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a chat.')
    } finally { setBusy(false) }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (activeId === null || (!text.trim() && !attachmentFile) || busy) return
    const body = text.trim()
    const file = attachmentFile
    setText('')
    setAttachmentFile(null)
    setEmojiOpen(false)
    setBusy(true)
    try {
      const result = file
        ? await request<{ message: DirectMessage }>(`/api/conversations/${activeId}/attachments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data: await fileToBase64(file), caption: body }),
        })
        : await request<{ message: DirectMessage }>(`/api/conversations/${activeId}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
        })
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message])
      await refreshConversations()
    } catch (cause) {
      setText(body)
      setAttachmentFile(file)
      setError(cause instanceof Error ? cause.message : 'Message could not be sent.')
    } finally { setBusy(false) }
  }

  const conversationName = (item: Conversation) => item.name || item.peers.map((peer) => peer.name).join(', ') || 'New chat'
  const timeLabel = (value: string | null) => value ? new Date(`${value.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  const selectAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.size || file.size > FILE_LIMIT) { setError('Choose a file between 1 byte and 3 MB.'); return }
    setError('')
    setAttachmentFile(file)
  }

  return (
    <main className={`messenger-app ${mobileChatOpen ? 'chat-open' : ''}`}>
      <aside className="messenger-sidebar">
        <header className="messenger-profile">
          <div className="messenger-brand"><span className="brand-mark"><Sparkles size={17} /></span><span>gather</span></div>
          <div className="profile-actions"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><button className="messenger-icon" title="Start a meeting" onClick={onStartCall}><Video size={19} /></button><button className="messenger-icon" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button><span className="profile-avatar" title={user.name}>{initials(user.name)}</span></div>
        </header>
        <div className="messenger-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or start a new chat" aria-label="Search people" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}</div>
        <div className="messenger-list-title"><span>{query.trim().length >= 2 ? 'PEOPLE' : 'CHATS'}</span><button title="Start a new chat" onClick={() => document.querySelector<HTMLInputElement>('.messenger-search input')?.focus()}><UserRoundPlus size={17} /></button></div>
        <div className="conversation-list">
          {query.trim().length >= 2 ? contacts.length ? contacts.map((contact) => <button className="conversation-row contact-result" key={contact.id} onClick={() => void startConversation(contact)} disabled={busy}><span className="conversation-avatar">{initials(contact.name)}</span><span className="conversation-copy"><b>{contact.name}</b><small>{contact.email}</small></span><MessageCircle size={17} /></button>) : <div className="list-hint">No people found.</div> : loading ? <div className="list-hint">Loading your chats…</div> : conversations.length ? conversations.map((item) => <button className={`conversation-row ${item.id === activeId ? 'active' : ''}`} key={item.id} onClick={() => openConversation(item.id)}><span className="conversation-avatar">{initials(conversationName(item))}</span><span className="conversation-copy"><b>{conversationName(item)}</b><small>{item.lastMessage || 'Say hello 👋'}</small></span><span className="conversation-meta"><time>{timeLabel(item.lastMessageAt)}</time>{item.unread > 0 && <i>{item.unread}</i>}</span></button>) : <div className="list-hint">No chats yet. Search by name or email to start one.</div>}
        </div>
        <div className="sidebar-meeting"><div className="sidebar-meeting-head"><span><Video size={15} /> MEETINGS</span><span className="secure-label"><span className="online-dot" /> Ready</span></div><button className="start-meeting-button" onClick={onStartCall} title="Create a meeting and host it with a private invite code"><Video size={16} /> Host a meeting</button><small className="meeting-create-note">A private invite link and code are generated automatically.</small><form className="join-meeting-form" onSubmit={onJoinRoom}><input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Meeting ID from link" aria-label="Meeting ID from invite link" maxLength={64} required /><input value={joinInviteCode} onChange={(event) => setJoinInviteCode(event.target.value.replace(/[^a-fA-F0-9]/g, '').slice(0, 12))} placeholder="12-character invite code" aria-label="Meeting invite code" maxLength={12} required /><button title="Join meeting" aria-label="Join meeting"><ArrowUpRight size={16} /></button></form>{roomError && <small className="meeting-error">{roomError}</small>}</div>
      </aside>
      <section className="messenger-main">
        {activeConversation && activePeer ? <>
          <header className="active-chat-header"><button className="mobile-back" onClick={() => setMobileChatOpen(false)} aria-label="Back to chats"><ArrowLeft size={19} /></button><span className="conversation-avatar">{initials(activePeer.name)}</span><div className="active-chat-name"><b>{activePeer.name}</b><small>{activePeer.email}</small></div><div className="active-chat-actions"><button className="messenger-icon" title="Start a video meeting" onClick={onStartCall}><Video size={19} /></button><button className="messenger-icon" title="Start a voice meeting" onClick={onStartCall}><Phone size={18} /></button><button className="messenger-icon" title="Search in conversation" onClick={() => document.querySelector<HTMLInputElement>('.messenger-search input')?.focus()}><Search size={18} /></button></div></header>
          <div className="message-history"><div className="message-day-label"><span>MESSAGES ARE PRIVATE TO THIS CHAT</span></div>{messages.length === 0 ? <div className="chat-empty"><span className="empty-art"><MessageCircle size={23} /></span><b>Start a conversation with {activePeer.name}</b><small>Messages are saved and sync live while you’re here.</small></div> : messages.map((item) => <article key={item.id} className={`message-bubble ${item.senderId === user.id ? 'mine' : ''}`}>{item.attachment && <a className="message-attachment" href={`/api/attachments/${item.attachment.id}`} download={item.attachment.name}><FileText size={18} /><span><b>{item.attachment.name}</b><small>{formatFileSize(item.attachment.size)}</small></span><ArrowDownToLine size={16} /></a>}{(!item.attachment || item.body !== `Shared a file: ${item.attachment.name}`) && <p>{item.body}</p>}<footer><time>{timeLabel(item.createdAt)}</time>{item.senderId === user.id && <CheckCheck size={14} />}</footer></article>)}<div ref={bottomRef} /></div>
          <div className="message-composer-wrap">{emojiOpen && <EmojiPicker onSelect={(emoji) => setText((value) => `${value}${emoji}`)} onClose={() => setEmojiOpen(false)} />}{attachmentFile && <div className="attachment-preview"><FileText size={17} /><span><b>{attachmentFile.name}</b><small>{formatFileSize(attachmentFile.size)} · Ready to send</small></span><button type="button" onClick={() => setAttachmentFile(null)} aria-label="Remove attachment"><X size={15} /></button></div>}<input ref={attachmentInputRef} className="attachment-input" type="file" onChange={selectAttachment} /><form className="message-composer" onSubmit={sendMessage}><button type="button" className="composer-icon" title="Emoji" aria-label="Open emoji picker" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((open) => !open)}><Smile size={22} /></button><button type="button" className="composer-icon" title="Add files" aria-label="Add files" onClick={() => attachmentInputRef.current?.click()}><Paperclip size={21} /></button><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a message" aria-label="Type a message" maxLength={4000} /><button className="send-message" aria-label="Send message" disabled={(!text.trim() && !attachmentFile) || busy}><Send size={18} /></button></form></div>
        </> : <div className="messenger-welcome"><div className="welcome-art"><MessageCircle size={51} /><span><CheckCheck size={18} /></span></div><h1>Keep the conversation going</h1><p>Choose a chat or find someone to message. Start a meeting whenever you want to talk face to face.</p><div className="welcome-rule" /><small><ShieldCheck size={14} /> Your chats stay connected to your account</small></div>}
        {error && <div className="messenger-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}
      </section>
    </main>
  )
}

function MeetingRoom({ user, roomId, inviteCode, inviteLink, theme, onToggleTheme, onLeave, onSignOut }: { user: User; roomId: string; inviteCode: string; inviteLink: string; theme: 'light' | 'dark'; onToggleTheme: () => void; onLeave: () => void; onSignOut: () => void }) {
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const remoteStreamRef = useRef(new Map<string, MediaStream>())
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peerConnections = useRef(new Map<string, RTCPeerConnection>())
  const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>())
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [files, setFiles] = useState<SharedFile[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [panel, setPanel] = useState<'chat' | 'people' | 'files' | 'board' | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [message, setMessage] = useState('')
  const [roomNotice, setRoomNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const activeStroke = useRef<Stroke | null>(null)
  const boardRef = useRef<SVGSVGElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const nextSocket = io({ withCredentials: true, reconnection: true, reconnectionAttempts: 5 })
    socketRef.current = nextSocket
    nextSocket.on('connect', () => {
      setConnection('connected')
      nextSocket.emit('room:join', { roomId, inviteCode })
    })
    nextSocket.on('connect_error', () => {
      setConnection('error')
      setRoomNotice('Could not connect to the room server. Please refresh and try again.')
    })
    nextSocket.on('room:peers', (peers: Participant[]) => {
      setParticipants([{ id: user.id, name: user.name, socketId: nextSocket.id ?? '' }, ...peers])
      for (const peer of peers) void createPeer(peer.socketId, true)
    })
    nextSocket.on('room:peer-joined', (peer: Participant) => {
      setParticipants((current) => current.some((item) => item.socketId === peer.socketId) ? current : [...current, peer])
    })
    nextSocket.on('room:peer-left', ({ socketId }: { socketId: string }) => {
      peerConnections.current.get(socketId)?.close()
      peerConnections.current.delete(socketId)
      pendingCandidates.current.delete(socketId)
      remoteStreamRef.current.delete(socketId)
      setRemoteStreams((current) => { const next = { ...current }; delete next[socketId]; return next })
      setParticipants((current) => current.filter((peer) => peer.socketId !== socketId))
    })
    nextSocket.on('room:signal', async ({ from, signal }: RoomSignal) => {
      const connectionForPeer = peerConnections.current.get(from) ?? await createPeer(from, false)
      try {
        if ('type' in signal && (signal.type === 'offer' || signal.type === 'answer')) {
          await connectionForPeer.setRemoteDescription(signal)
          const candidates = pendingCandidates.current.get(from) ?? []
          for (const candidate of candidates) await connectionForPeer.addIceCandidate(candidate)
          pendingCandidates.current.delete(from)
          if (signal.type === 'offer') {
            const answer = await connectionForPeer.createAnswer()
            await connectionForPeer.setLocalDescription(answer)
            nextSocket.emit('room:signal', { roomId, target: from, signal: connectionForPeer.localDescription })
          }
        } else if ('candidate' in signal && signal.candidate) {
          if (connectionForPeer.remoteDescription) await connectionForPeer.addIceCandidate(signal)
          else pendingCandidates.current.set(from, [...(pendingCandidates.current.get(from) ?? []), signal])
        }
      } catch {
        setRoomNotice('A connection to a participant could not be established.')
      }
    })
    nextSocket.on('room:chat', (incoming: ChatMessage) => setMessages((current) => [...current.slice(-99), incoming]))
    nextSocket.on('room:file', (incoming: SharedFile) => setFiles((current) => [...current.slice(-19), incoming]))
    nextSocket.on('room:stroke', (stroke: Stroke) => setStrokes((current) => [...current.filter((item) => item.id !== stroke.id).slice(-99), stroke]))
    nextSocket.on('room:board-clear', () => setStrokes([]))
    nextSocket.on('room:error', ({ error }: { error: string }) => setRoomNotice(error))
    return () => {
      nextSocket.emit('room:leave', { roomId })
      nextSocket.disconnect()
      socketRef.current = null
      for (const peer of peerConnections.current.values()) peer.close()
      peerConnections.current.clear()
      remoteStreamRef.current.clear()
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [roomId, inviteCode, user.id, user.name])

  useEffect(() => {
    let disposed = false
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (disposed) { stream.getTracks().forEach((track) => track.stop()); return }
        localStreamRef.current = stream
        setLocalStream(stream)
        for (const connection of peerConnections.current.values()) {
          for (const track of stream.getTracks()) {
            const sender = connection.getSenders().find((item) => item.track?.kind === track.kind)
            if (sender) void sender.replaceTrack(track)
            else connection.addTrack(track, stream)
          }
        }
      })
      .catch(() => setRoomNotice('Camera or microphone access was denied. You can still listen and use chat.'))
    return () => { disposed = true }
  }, [])

  const createPeer = useCallback(async (peerId: string, offer: boolean) => {
    const existing = peerConnections.current.get(peerId)
    if (existing) return existing
    const connection = new RTCPeerConnection(ICE_SERVERS)
    peerConnections.current.set(peerId, connection)
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) connection.addTrack(track, localStreamRef.current)
    } else {
      connection.addTransceiver('audio', { direction: 'sendrecv' })
      connection.addTransceiver('video', { direction: 'sendrecv' })
    }
    connection.onicecandidate = (event) => {
      if (event.candidate) socketRef.current?.emit('room:signal', { roomId, target: peerId, signal: event.candidate })
    }
    connection.ontrack = (event) => {
      let stream = event.streams[0] ?? remoteStreamRef.current.get(peerId)
      if (!stream) stream = new MediaStream()
      if (!event.streams[0] && !stream.getTracks().some((track) => track.id === event.track.id)) stream.addTrack(event.track)
      remoteStreamRef.current.set(peerId, stream)
      setRemoteStreams((current) => ({ ...current, [peerId]: stream! }))
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') setRoomNotice('A participant connection failed. Check your network and try rejoining.')
    }
    if (offer) {
      const description = await connection.createOffer()
      await connection.setLocalDescription(description)
      socketRef.current?.emit('room:signal', { roomId, target: peerId, signal: connection.localDescription })
    }
    return connection
  }, [roomId])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, panel])

  const toggleAudio = () => {
    const next = !muted
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next })
    setMuted(next)
  }
  const toggleVideo = () => {
    const next = !cameraOff
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next })
    setCameraOff(next)
  }

  const toggleScreenShare = async () => {
    if (screenStreamRef.current) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
      for (const connection of peerConnections.current.values()) {
        const sender = connection.getSenders().find((item) => item.track?.kind === 'video')
        if (sender && cameraTrack) await sender.replaceTrack(cameraTrack)
      }
      screenStreamRef.current.getTracks().forEach((track) => track.stop())
      screenStreamRef.current = null
      setRoomNotice('Screen sharing stopped.')
      return
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true })
      screenStreamRef.current = screen
      const screenTrack = screen.getVideoTracks()[0]
      for (const connection of peerConnections.current.values()) {
        const sender = connection.getSenders().find((item) => item.track?.kind === 'video')
        if (sender) await sender.replaceTrack(screenTrack)
        else connection.addTrack(screenTrack, screen)
      }
      screenTrack.onended = () => { void toggleScreenShare() }
      setRoomNotice('You are sharing your screen.')
    } catch {
      setRoomNotice('Screen sharing was cancelled or is not available in this browser.')
    }
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = message.trim()
    if (!text) return
    socketRef.current?.emit('room:chat', { roomId, text })
    setMessage('')
  }

  const shareFile = async (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !socketRef.current) return
    if (file.size > FILE_LIMIT) { setRoomNotice('Choose a file smaller than 3 MB.'); return }
    if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.type)) {
      setRoomNotice('For safety, share a PDF, image, or plain-text file.')
      return
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read file'))
      reader.onerror = () => reject(new Error('Unable to read file'))
      reader.readAsDataURL(file)
    })
    socketRef.current.emit('room:file', { roomId, name: file.name, type: file.type, size: file.size, data })
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${inviteLink}\nMeeting invite code: ${inviteCode}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setRoomNotice(`Invite link: ${inviteLink} · Invite code: ${inviteCode}`)
    }
  }

  const startStroke = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
    const nextStroke: Stroke = { id: crypto.randomUUID(), color: '#5946d2', points: [point] }
    activeStroke.current = nextStroke
    event.currentTarget.setPointerCapture(event.pointerId)
    setStrokes((current) => [...current.slice(-99), nextStroke])
  }
  const continueStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (!activeStroke.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    activeStroke.current.points.push({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
    const stroke = activeStroke.current
    setStrokes((current) => [...current.filter((item) => item.id !== stroke.id), stroke])
    socketRef.current?.emit('room:stroke', { roomId, stroke })
  }
  const endStroke = () => { activeStroke.current = null }
  const leave = () => { onLeave() }

  return (
    <main className="meeting-shell">
      <header className="meeting-topbar"><button className="meeting-back" onClick={leave}><ArrowLeft size={17} /><span>Back to home</span></button><div className="room-title"><span className="brand-mark"><Sparkles size={17} /></span><span className="room-name">Gather room</span><span className="room-divider">/</span><span className="room-code">Invite: {inviteCode}</span><button className="icon-button copy-room" onClick={copyInvite} title="Copy generated meeting link and invite code">{copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? 'Copied' : 'Copy invite'}</span></button></div><div className="meeting-status"><ThemeToggle theme={theme} onToggle={onToggleTheme} /><span className={`status-pip ${connection}`} />{connection === 'connected' ? 'Room is live' : connection === 'error' ? 'Reconnecting' : 'Connecting…'}<button className="user-menu" title="Sign out" onClick={onSignOut}><span className="avatar avatar-lilac">{initials(user.name)}</span></button></div></header>
      {roomNotice && <div className="room-toast" role="status">{roomNotice}<button onClick={() => setRoomNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
      <div className="meeting-content">
        <section className={`stage ${panel ? 'stage-with-panel' : ''}`}>
          <div className="stage-heading"><div><span className="eyebrow">A GOOD PLACE TO START</span><h1>Room to think.</h1></div><div className="stage-heading-right"><span className="participant-count"><Users size={15} /> {participants.length} here</span><button className="invite-button" onClick={copyInvite}><Link2 size={15} /> Invite</button></div></div>
          <div className={`video-grid ${participants.length <= 1 ? 'video-grid-solo' : ''}`}>
            <VideoTile name={user.name} stream={localStream} local muted={muted} cameraOff={cameraOff} />
            {participants.filter((peer) => peer.id !== user.id).map((peer) => <VideoTile key={peer.socketId} name={peer.name} stream={remoteStreams[peer.socketId] ?? null} />)}
            {participants.length < 2 && <div className="empty-tile"><span className="empty-art"><Users size={25} /></span><b>Good things are better shared.</b><p>Copy the invite link and bring your people in.</p><button className="text-button" onClick={copyInvite}>{copied ? 'Link copied!' : 'Copy invite link'} <ArrowUpRight size={14} /></button></div>}
          </div>
          <div className="call-controls">
            <div className="control-group"><button className={`call-control ${muted ? 'control-off' : ''}`} onClick={toggleAudio} title={muted ? 'Turn microphone on' : 'Mute microphone'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}<span>{muted ? 'Unmute' : 'Mute'}</span></button><button className={`call-control ${cameraOff ? 'control-off' : ''}`} onClick={toggleVideo} title={cameraOff ? 'Turn camera on' : 'Turn camera off'}>{cameraOff ? <VideoOff size={18} /> : <Video size={18} />}<span>Camera</span></button><button className={`call-control ${screenStreamRef.current ? 'control-active' : ''}`} onClick={() => void toggleScreenShare()} title="Share screen"><MonitorUp size={18} /><span>Share</span></button></div>
            <div className="control-center"><span className="call-time"><span className="live-pip" /> LIVE</span><span>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}</span></div>
            <button className="leave-button" onClick={leave}><Headphones size={17} /><span>Leave room</span></button>
          </div>
          <nav className="tool-dock" aria-label="Room tools">
            <button className={panel === 'chat' ? 'selected' : ''} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageCircle size={18} /><span>Chat</span>{messages.length > 0 && <i className="tool-badge">{messages.length > 9 ? '9+' : messages.length}</i>}</button>
            <button className={panel === 'people' ? 'selected' : ''} onClick={() => setPanel(panel === 'people' ? null : 'people')}><Users size={18} /><span>People</span></button>
            <button className={panel === 'files' ? 'selected' : ''} onClick={() => setPanel(panel === 'files' ? null : 'files')}><Files size={18} /><span>Files</span></button>
            <button className={panel === 'board' ? 'selected' : ''} onClick={() => setPanel(panel === 'board' ? null : 'board')}><Pencil size={18} /><span>Whiteboard</span></button>
          </nav>
        </section>
        {panel && <aside className="side-panel">
          <div className="panel-header"><div><span className="eyebrow">ROOM TOOL</span><h2>{panel === 'chat' ? 'Room chat' : panel === 'people' ? 'In the room' : panel === 'files' ? 'Shared files' : 'Whiteboard'}</h2></div><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close panel"><X size={18} /></button></div>
          {panel === 'chat' && <><div className="chat-messages">{messages.length === 0 ? <div className="panel-empty"><span className="empty-art"><MessageCircle size={21} /></span><b>A fresh conversation.</b><p>Say hello or share an idea with the room.</p></div> : messages.map((item) => <div className={`chat-message ${item.userId === user.id ? 'own-message' : ''}`} key={item.id}><span className="avatar avatar-small avatar-lilac">{initials(item.name)}</span><div><div className="chat-meta"><b>{item.name}</b><time>{new Date(item.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{item.text}</p></div></div>)}<div ref={messagesEndRef} /></div><form className="chat-composer" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Send a little note…" maxLength={1000} aria-label="Chat message" /><button aria-label="Send message" disabled={!message.trim()}><Send size={17} /></button></form><span className="panel-footnote"><ShieldCheck size={13} /> Only people in this room can see messages.</span></>}
          {panel === 'people' && <div className="people-list">{participants.map((peer) => <div className="person-row" key={peer.socketId}><span className={`avatar ${peer.id === user.id ? 'avatar-lilac' : 'avatar-peach'}`}>{initials(peer.name)}</span><div><b>{peer.name}{peer.id === user.id && <span className="you-tag">YOU</span>}</b><small><span className="online-dot" /> In the room</small></div><MoreHorizontal size={17} /></div>)}<button className="invite-wide" onClick={copyInvite}><Plus size={16} /> Invite someone new</button></div>}
          {panel === 'files' && <><div className="files-list">{files.length === 0 ? <div className="panel-empty"><span className="empty-art"><Files size={21} /></span><b>Nothing shared just yet.</b><p>Drop a useful file and keep the momentum going.</p></div> : files.map((file) => <div className="shared-file" key={file.id}><span className="file-icon"><FileText size={18} /></span><span className="shared-file-info"><b>{file.name}</b><small>{file.sender} · {(file.size / 1024).toFixed(0)} KB</small></span><a href={file.data} download={file.name} aria-label={`Download ${file.name}`}><ArrowDownToLine size={16} /></a></div>)}</div><label className="upload-button"><Paperclip size={16} /> Share a file<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" onChange={(event) => void shareFile(event)} /></label><span className="panel-footnote"><ShieldCheck size={13} /> PDF, image, or text · up to 3 MB</span></>}
          {panel === 'board' && <><div className="board-toolbar"><span>Sketch an idea together</span><button className="text-button" onClick={() => { setStrokes([]); socketRef.current?.emit('room:board-clear', { roomId }) }}>Clear board</button></div><svg ref={boardRef} className="whiteboard" viewBox="0 0 1000 640" preserveAspectRatio="none" onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={endStroke} onPointerCancel={endStroke}>{strokes.map((stroke) => <polyline key={stroke.id} points={stroke.points.map((point) => `${point.x * 1000},${point.y * 640}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />)}</svg><span className="panel-footnote"><Pencil size={13} /> Draw with your mouse or finger. Strokes sync live.</span></>}
        </aside>}
      </div>
    </main>
  )
}

function VideoTile({ name, stream, local = false, muted = false, cameraOff = false }: { name: string; stream: MediaStream | null; local?: boolean; muted?: boolean; cameraOff?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    return () => { video.srcObject = null }
  }, [stream])
  const videoTrackOff = stream?.getVideoTracks().every((track) => track.readyState !== 'live' || !track.enabled) ?? true
  return <div className={`video-tile ${local ? 'local-video' : ''}`}><video ref={videoRef} autoPlay playsInline muted={local} className={cameraOff || videoTrackOff ? 'hidden-video' : ''} /><div className={`video-placeholder ${local ? 'avatar-lilac' : 'avatar-peach'} ${cameraOff || videoTrackOff ? '' : 'placeholder-hidden'}`}>{initials(name)}</div><div className="tile-gradient" /><div className="tile-name"><span className="tile-speaking" />{name}{local && <span className="you-tag">YOU</span>}</div><div className="tile-controls">{local && muted && <span title="Microphone muted"><MicOff size={14} /></span>}<button aria-label={`More options for ${name}`}><MoreHorizontal size={18} /></button></div></div>
}

export default App
