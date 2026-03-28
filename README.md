# ChatDude

ChatDude is a lightweight realtime chat app built for a static frontend on GitHub Pages and a Node.js + Socket.IO backend on Render.

## What is in this version

- Guest mode for quick room access
- Account creation and login with password-based auth
- Saved appearance preferences for registered users
- Public room history persisted on the backend
- Custom room creation for registered users
- Private messaging for registered users
- Lightweight published camera/audio streams for registered users
- Guest auto-reconnect using the last guest name on the same device
- Basic moderation: room creators can delete their rooms, and registered users can delete their own messages
- Room presence, typing indicators, and clickable user actions
- Responsive, modernized UI split into [index.html](C:\Users\dontb\OneDrive\Desktop\chat-app\index.html), [styles.css](C:\Users\dontb\OneDrive\Desktop\chat-app\styles.css), and [app.js](C:\Users\dontb\OneDrive\Desktop\chat-app\app.js)

## Architecture

- Frontend: static files hosted by GitHub Pages
- Backend: [server.js](C:\Users\dontb\OneDrive\Desktop\chat-app\server.js) on Express + Socket.IO
- Transport: cross-origin HTTP + Socket.IO with CORS support
- Persistence: hosted Postgres when `DATABASE_URL` is set, otherwise a local JSON fallback at `data/store.json`

## Persistence

ChatDude now supports two persistence modes:

- `Postgres` when `DATABASE_URL` is configured
- `file` fallback when `DATABASE_URL` is missing

For Render production use, you should set `DATABASE_URL` so accounts, rooms, room history, and private-message history survive redeploys.

The backend will automatically:

- create the required Postgres tables on boot
- seed the default rooms
- import existing `data/store.json` data once if the database is still empty

That means you can migrate from the old file-backed store without manually rebuilding users and rooms.

## Local development

1. Install dependencies with `npm install`
2. Start the backend with `npm start`
3. Open [index.html](C:\Users\dontb\OneDrive\Desktop\chat-app\index.html) in a browser or serve the repo root with any static file server

By default, the frontend points at `https://chatdude-1091.onrender.com`.

## Deployment

### Render backend

- Service name: `ChatDude`
- Start command: `npm start`
- Port: `process.env.PORT || 3000`

Recommended environment variables:

```env
CLIENT_ORIGIN=https://your-github-pages-site.github.io
AUTH_SECRET=replace-this-with-a-long-random-secret
DATABASE_URL=postgresql://...
```

Notes:

- `CLIENT_ORIGIN` can be a comma-separated list of allowed frontend origins.
- `AUTH_SECRET` should be set in Render so account tokens are not signed with the development fallback secret.
- `DATABASE_URL` should point to a hosted Postgres database. This is the recommended production setup for stopping account loss on redeploy.
- If you are connecting to a local Postgres instance without SSL, you can set `PGSSL_DISABLE=true`.
- Published cameras use browser WebRTC over HTTPS with Socket.IO signaling through the existing Render backend.
- This implementation is optimized for small-room viewing on free-tier hosting by using direct peer-to-peer connections instead of a separate media server.

### Hosted database options

This backend is written against standard Postgres, so practical free-tier-friendly options include:

- Neon
- Supabase Postgres
- Render Postgres

If you already use Render for the web service, Render Postgres is the most direct setup. If you want the smallest possible always-on free-tier footprint, Neon is a good fit too.

### GitHub Pages frontend

The frontend stays static-host friendly. No build step is required.

If you ever need to point the frontend at a different backend, override the config before loading [app.js](C:\Users\dontb\OneDrive\Desktop\chat-app\app.js):

```html
<script>
  window.CHATDUDE_CONFIG = {
    serverUrl: "https://chatdude-1091.onrender.com"
  };
</script>
```

## Account model

- Guests can join public rooms and post room messages
- Registered users can log in, save appearance settings, create custom rooms, and send private messages
- Passwords are hashed server-side with Node's built-in `crypto.scryptSync`

## Runtime files

- `data/store.json` is generated automatically at runtime and is gitignored
- `data/.gitkeep` exists only so the runtime data directory is present in the repo

## Next sensible upgrades

1. Add moderation actions like mute, kick, and room ownership controls
2. Persist richer private-message threads and inbox state server-side
3. Add reconnect-aware session restoration for guests
4. Add password reset and email-backed auth later if needed
