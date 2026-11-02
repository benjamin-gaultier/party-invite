# Party Invite

A private mini social space for each real-life event. The host creates an event and
gets one link to share on WhatsApp, Instagram, etc. Guests open it, type their name
once and they're in. No accounts, no app. The browser remembers them, so opening the
link again goes straight into the event.

**MVP so far:** create event (title, date, time, address, details), unguessable share
link, join with a name, remembered return visits, guest list, RSVP (going / maybe /
can't go), map link for the address, host can edit details, "Your events" list on the
home page (stored in the browser), theme / dress code, Spotify playlist link with an
embedded player and a message for guests, comment wall (refreshes every 8 seconds),
guests add songs to the host's Spotify playlist from the app (no Spotify account needed),
app in French, host-chosen background picture via a floating organizer-only button (resized in the browser, stored in D1).

**Next:** shared checklist/notes, link previews and polish,
photos later.

## Stack

- **Cloudflare Workers** with static assets: `src/index.ts` (Hono) serves `/api/*`,
  everything else is the single-page app in `public/` (plain JS, no build step).
- **Cloudflare D1** (SQLite) for events and guests: `migrations/`.
- **Identity:** joining returns a random token. The browser keeps it in `localStorage`
  and sends it as `Authorization: Bearer …`; the server stores only its SHA-256 hash.
  Tokens are scoped to one event.

## Run locally

```sh
npm install
npm run db:migrate:local
npm run dev            # http://localhost:8787
npm run smoke          # in a second terminal: end-to-end API checks
npm run typecheck
```

## Spotify (guests add songs from the app)

The host connects their Spotify account once from the event page. Guests then search
and add tracks through `/api/parties/:id/spotify/*`; the Worker calls Spotify with the
host's token, so guests need no Spotify account. If the event has no playlist link,
connecting creates a public playlist named after the event.

Setup (once):

1. Create an app at <https://developer.spotify.com/dashboard> (the owner needs Spotify
   Premium for development-mode apps). Tick **Web API**, add the redirect URI
   `https://<your-worker-host>/api/spotify/callback` (add preview hosts too if you test there).
2. Under **User Management**, add the Spotify account of every host who will connect
   (max 5 in development mode). Guests don't need to be listed.
3. Set Worker secrets `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (dashboard →
   Workers → party-invite → Settings → Variables and Secrets). Without them the
   "Connecter Spotify" button is hidden and the playlist link/embed still works.

Local test without Spotify: `npm run fake-spotify`, then
`npx wrangler dev --var SPOTIFY_CLIENT_ID:test --var SPOTIFY_CLIENT_SECRET:test --var SPOTIFY_API_URL:http://localhost:8788/v1 --var SPOTIFY_ACCOUNTS_URL:http://localhost:8788`
and `npm run smoke:spotify`.

## Deploy to Cloudflare

The production D1 database `party-invite` already exists (its id is in `wrangler.jsonc`)
and has `0001_init.sql` applied. `0002_theme_playlist_comments.sql` must be applied
before the deploy that adds theme, playlist and comments.

Deploys run through **Cloudflare Workers Builds**: in the Cloudflare dashboard,
Workers & Pages → Create → Import a repository → `party-invite`, keep the default
deploy command (`npx wrangler deploy`). Every push to `main` then goes live at
`https://party-invite.<your-subdomain>.workers.dev`.

New migrations must be applied to the remote database before (or with) the deploy
that needs them: `npm run db:migrate:remote` (needs `npx wrangler login`), or
switch the Workers Builds deploy command to `npm run deploy`, which applies
migrations and then deploys.

## API

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| POST | `/api/parties` | none | Create event `{title, date, time?, address?, description?, hostName}` → `{eventId, guest:{id, token}}` |
| GET | `/api/parties/:id` | optional | With a valid token: `{event, me, guests}`. Without: `{preview}` for the join screen |
| POST | `/api/parties/:id/join` | none | `{name}` → `{guest:{id, token}}` |
| PUT | `/api/parties/:id/rsvp` | guest | `{status: going \| maybe \| not_going}` |
| PATCH | `/api/parties/:id/me` | guest | Rename yourself `{name}` |
| PATCH | `/api/parties/:id` | host | Edit event fields (incl. `theme`, `playlist_url`, `playlist_note`) |
| GET | `/api/parties/:id/comments` | guest | `{comments}` (latest 200, oldest first) |
| POST | `/api/parties/:id/comments` | guest | `{body}` → `{comments}` |
| DELETE | `/api/parties/:id/comments/:commentId` | author or host | → `{comments}` |
| GET | `/api/parties/:id/background?v=` | none | The event's background picture |
| PUT | `/api/parties/:id/background` | host | Raw JPEG/PNG/WebP body (≤ 1 MB) → full event |
| DELETE | `/api/parties/:id/background` | host | Remove the picture |
| POST | `/api/parties/:id/spotify/connect` | host | → `{url}` Spotify consent page |
| GET | `/api/spotify/callback` | (Spotify) | OAuth return, redirects to `/e/:id?spotify=…` |
| DELETE | `/api/parties/:id/spotify` | host | Disconnect Spotify |
| GET | `/api/parties/:id/spotify/search?q=` | guest | `{tracks}` (10 max) |
| POST | `/api/parties/:id/spotify/songs` | guest | `{trackId}` → adds to the playlist, `{songs}` |
