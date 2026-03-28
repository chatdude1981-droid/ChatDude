# ChatDude

ChatDude is a lightweight realtime chat app built for a static frontend on GitHub Pages and a Node.js + Socket.IO backend on Render.

## What is in this version

- Guest mode for quick room access
- Account creation and login with password-based auth
- Saved appearance preferences for registered users
- Public room history persisted on the backend
- Custom room creation for registered users
- Private messaging for registered users
- Guest auto-reconnect using the last guest name on the same device
- Basic moderation: room creators can delete their rooms, and registered users can delete their own messages
- Room presence, typing indicators, and clickable user actions
- Responsive, modernized UI split into [index.html](C:\Users\dontb\OneDrive\Desktop\chat-app\index.html), [styles.css](C:\Users\dontb\OneDrive\Desktop\chat-app\styles.css), and [app.js](C:\Users\dontb\OneDrive\Desktop\chat-app\app.js)

## Architecture

- Frontend: static files hosted by GitHub Pages
- Backend: [server.js](C:\Users\dontb\OneDrive\Desktop\chat-app\server.js) on Express + Socket.IO
- Transport: cross-origin HTTP + Socket.IO with CORS support
- Persistence: file-backed JSON store created at `data/store.json`

## Important persistence note

The current persistence layer is intentionally lightweight and free-tier friendly, but it writes to the local filesystem. That works well for local development and for deployments with persistent disk.

If your Render service is on an ephemeral filesystem, user accounts, room history, and saved preferences can be lost on restart or redeploy. For stronger production persistence, move the same data model to a managed database.

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
```

Notes:

- `CLIENT_ORIGIN` can be a comma-separated list of allowed frontend origins.
- `AUTH_SECRET` should be set in Render so account tokens are not signed with the development fallback secret.
- If you want persistence on Render, attach a persistent disk or move to a hosted database.

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

1. Move persistence to Postgres or another managed database
2. Add moderation actions like mute, kick, and room ownership controls
3. Persist private-message threads per user
4. Add reconnect-aware session restoration for guests
5. Add password reset and email-backed auth later if needed
