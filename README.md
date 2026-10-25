# Gather

Gather is a messaging-first chat and meeting app built with React, WebRTC, Socket.IO, Express, and SQLite.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Vite serves the frontend and proxies API and Socket.IO traffic to the Express server on port 3001. The server creates `gather.sqlite` in the project directory on first start. Camera and microphone access require `localhost` or HTTPS.

Set `JWT_SECRET` to a long random value and `DB_PATH` to a persistent database path before deployment. In production, serve the app over HTTPS and set `APP_ORIGIN` to the app's origin. The development server uses an ephemeral signing key when `JWT_SECRET` is absent, so sessions do not survive a restart.

## Included

- Email and password registration and sign in, with bcrypt password hashes and HTTP-only session cookies.
- Contact search, persistent one-to-one conversations, and real-time text messaging.
- Authenticated multi-person WebRTC video and audio rooms, with Socket.IO signaling.
- Screen sharing, room chat, small file sharing, and a live shared whiteboard.
- Room-scoped Socket.IO events and input validation.

WebRTC encrypts media in transit with DTLS-SRTP. This app does not implement end-to-end encryption for chat, shared files, or whiteboard data. The current peer-to-peer mesh is intended for small rooms; larger rooms need an SFU such as mediasoup or LiveKit. Files and collaboration history are currently held in room memory and are not persisted.
