# ChatDude

ChatDude is a lightweight hosted community chat product built for a static GitHub Pages frontend and a low-cost Render backend. The goal is not just "realtime chat works," but "this feels like something you could demo, grow, and eventually sell."

## What It Is

ChatDude is designed for:

- lightweight niche communities
- private invite-style groups
- hobby groups or creator communities
- demo-friendly hosted chat rooms with a clear upgrade path

It supports fast guest entry, registered accounts, custom rooms, friends, private messaging, and lightweight browser-based media without forcing a full paid infrastructure stack on day one.

## Feature Snapshot

### Core chat

- guest entry with a low-friction join flow
- account registration and login
- room switching with room picker
- room history persistence
- custom room creation for registered users
- typing indicators
- polished inline timestamps using the viewer's local time

### Social layer

- private messaging inbox
- draggable PM window
- friend list and friend room-entry notices
- block/unblock controls
- presence states: online, busy, idle
- saved profile basics: display name and status message

### Media

- lightweight published room camera windows
- private voice/video call flows in PMs
- draggable/resizable media windows
- privacy controls around camera visibility

### Product/value signals

- plan model in code: `Guest`, `Free Registered`, `Premium`
- feature flags exposed in session data for future billing gates
- stronger auth validation and password strength checks
- reconnect/cold-start banner for Render free-tier behavior
- room link sharing for demo/invite flows
- privacy/terms placeholder pages

## Stack

- Frontend: static HTML, CSS, and vanilla JS
- Backend: Node.js, Express, Socket.IO
- Persistence: Postgres when `DATABASE_URL` is set, otherwise JSON file fallback
- Hosting:
  - GitHub Pages for frontend
  - Render web service for backend

This repo intentionally avoids a build step so deployment stays simple and cheap.

## Architecture Summary

- [index.html](C:\Users\dontb\OneDrive\Desktop\chat-app\index.html): static app shell and UI structure
- [styles.css](C:\Users\dontb\OneDrive\Desktop\chat-app\styles.css): visual system and layout
- [app.js](C:\Users\dontb\OneDrive\Desktop\chat-app\app.js): client state, auth flows, rooms, PMs, media UX, reconnect handling
- [server.js](C:\Users\dontb\OneDrive\Desktop\chat-app\server.js): auth, APIs, Socket.IO events, validation, rate limiting, session state
- [persistence.js](C:\Users\dontb\OneDrive\Desktop\chat-app\persistence.js): Postgres/file persistence adapter

## Free-Tier Constraints

ChatDude is optimized around the current low-cost setup, but there are real limits:

- Render free web services can cold-start after inactivity. The app now handles that with clearer loading/reconnect messaging instead of pretending the app is broken.
- Do not rely on a newly created free Render Postgres instance for critical long-term storage unless you accept its lifecycle limits.
- Browser media is intentionally lightweight and peer-to-peer. It is suitable for small calls and camera sharing, not large-scale group video.
- No Redis, paid TURN, paid object storage, or billing stack is required right now.

## Persistence Modes

ChatDude supports two persistence modes:

- `postgres`: recommended for production
- `file`: local fallback only

The backend automatically:

- creates required Postgres tables on boot
- seeds default rooms
- imports `data/store.json` once if the database is empty

If `DATABASE_URL` is missing, the app falls back to file storage and redeploys can wipe accounts/history.

## Environment Variables

Recommended Render variables:

```env
CLIENT_ORIGIN=https://your-github-pages-site.github.io
AUTH_SECRET=replace-this-with-a-long-random-secret
DATABASE_URL=postgresql://...
PREMIUM_USERNAMES=comma,separated,usernames
PGSSL_DISABLE=false
```

Notes:

- `CLIENT_ORIGIN` may be a comma-separated list.
- `AUTH_SECRET` should always be set in production.
- `DATABASE_URL` should point to a hosted Postgres database if you want persistence across deploys.
- `PREMIUM_USERNAMES` is an admin/development feature gate for monetization readiness before billing exists.
- `PGSSL_DISABLE=true` is only for local or non-SSL Postgres.

## Local Setup

1. Run `npm install`
2. Run `npm start`
3. Open [index.html](C:\Users\dontb\OneDrive\Desktop\chat-app\index.html) directly or serve the repo root with a static server

By default, the frontend targets `https://chatdude-1091.onrender.com`.

## Deployment Notes

### Render

- Service name: `ChatDude`
- Start command: `npm start`
- Port: `process.env.PORT || 3000`

### GitHub Pages

- No build step required
- Frontend remains static-host friendly

To override the backend URL:

```html
<script>
  window.CHATDUDE_CONFIG = {
    serverUrl: "https://chatdude-1091.onrender.com"
  };
</script>
```

## Demo-Friendly Default Experience

Out of the box, ChatDude is seeded with:

- `General`
- `Random`
- `Gaming`

That gives a fresh deploy a usable, understandable starting point immediately.

## Monetization Readiness

ChatDude does not include billing yet, but the app now has a plan structure in code so payments can be layered in later without a large refactor:

- `Guest`
- `Free Registered`
- `Premium`

Current premium-oriented gates are code-ready for:

- private room creation
- room branding/customization
- extended PM history
- advanced moderation

The current setup is intentionally informational/admin-gated rather than payment-backed.

## Roadmap

### Still fits current free/low-cost setup

- better room moderation UX
- richer PM conversation management
- better mobile-specific layout polish
- improved onboarding copy and guided first-run experience
- room invite landing improvements

### When it becomes worth paying

- paid TURN/SFU for reliable larger media usage
- object storage for avatars/uploads
- email/password reset flows
- billing integration
- richer moderation tooling backed by more robust infrastructure

## Trust Pages

- [Privacy](C:\Users\dontb\OneDrive\Desktop\chat-app\privacy.html)
- [Terms](C:\Users\dontb\OneDrive\Desktop\chat-app\terms.html)

These are lightweight placeholders suitable for early demos, not final legal advice.
