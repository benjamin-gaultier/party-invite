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
guests say who comes with them (+1/+N, names optional; companions count in the totals and show in the guest list; the host sets how many each guest may bring),
host can remove a guest or merge a duplicate guest into the original (comments, reactions, songs and RSVP move over; the duplicate's link keeps opening the original via `guest_aliases`),
app in French, host-chosen colors and background picture via floating organizer-only buttons (resized in the browser, stored in D1).

**Next:** shared checklist/notes, link previews and polish.

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

## Comments: emojis, GIFs and @mentions

Guests can add emojis from a picker, tag someone with `@` (or the "Répondre" button), and
send GIFs. A tagged guest sees that comment highlighted. Everything lives in the existing
`comments.body` text: a GIF is stored as a `[gif:ID]` line and shown from media.giphy.com.
No database change.

Guests react to a comment with an emoji, WhatsApp-style: one reaction per guest, a new one replaces it, tapping yours again removes it (tap ＋ or long-press the comment). Stored in `comment_likes` (migrations 0006 and 0007, `emoji` column, default ❤️). The 🔔 on the event page
lists who reacted to your comments or tagged you, with a red count for anything newer than the
last time you opened it (kept in the browser next to the guest token). It is built from the
comments the page already polls every 8 seconds, so there is no separate notifications table,
and a toast pops up when something new arrives while the page is open. No phone push yet.

"Répondre" quotes the comment above the text box; the reply is stored with a first `[reply:ID]` line, shown as a quote you can tap to jump to the original, and notifies its author in the 🔔.

Guests can attach up to 4 photos or GIFs from their phone to a comment (📷, paste or drop). Photos are shrunk in the browser to about 1600px JPEG, and GIFs (4 MB max) are kept as they are so they still move. Files go to the album's R2 bucket under `<event>/c/<id>`, and the comment carries `[img:ID:WxH]` lines, so there is no extra table. Deleting the comment or the event deletes the files.

GIF search goes through the Worker (`GET /api/parties/:id/gifs?q=`) so the key stays secret.
Setup: create an app at <https://developers.giphy.com/dashboard/> (API, not SDK) and set its
key as the Worker secret `GIPHY_API_KEY`. Without it the GIF button is hidden. A free key
allows about 100 searches an hour; results are cached for an hour per search term.

Local test: `node scripts/fake-giphy.mjs`, then
`npx wrangler dev --var GIPHY_API_KEY:test --var GIPHY_API_URL:http://localhost:8789/v1`
and `npm run smoke`.

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
| PUT | `/api/parties/:id/color` | host | `{color}`: "", metro, bleu, vert, rose, rouge, orange, nuit |
| POST | `/api/parties/:id/spotify/connect` | host | → `{url}` Spotify consent page |
| GET | `/api/spotify/callback` | (Spotify) | OAuth return, redirects to `/e/:id?spotify=…` |
| DELETE | `/api/parties/:id/spotify` | host | Disconnect Spotify |
| GET | `/api/parties/:id/spotify/search?q=` | guest | `{tracks}` (10 max) |
| POST | `/api/parties/:id/spotify/songs` | guest | `{trackId}` → adds to the playlist, `{songs}` |

## Photo album

The event page has a 📸 Photos card, separate from the comments. Guests pick several photos
at once; the browser shrinks each to about 1600px JPEG (which also strips EXIF data such as
GPS position) plus a 480px thumbnail, and sends them one by one. Tapping a photo opens a
full-screen viewer (swipe or arrows) showing who posted it, with Enregistrer (download) and
Supprimer (the author, or any host). A host can tick "Ouvrir l'album aux invités seulement le
jour de la fête": guests can then add photos from the event date on (Paris time), hosts always.

Files live in R2 (binding `PHOTOS`) under `<event id>/<photo id>` and `<event id>/<photo id>.thumb`;
table `photos` (migration 0009) says who posted what, and `events.photos_party_day` holds the
setting. Images are served by `GET /api/parties/:id/photos/:photoId[?thumb=1|?download=1]`
without the guest token (like the background picture: both ids are random). Removing a guest
or deleting the event also deletes their files; merging a duplicate moves their photos.
Limits: 2 MB per photo, 100 photos per guest per hour, 1000 per event.

Setup (once): enable R2 in the Cloudflare dashboard (R2 Object Storage, free tier covers 10 GB),
create buckets `party-invite-photos` and `party-invite-photos-preview`, apply migration 0009.
Until the bucket binding and migration are there, the card only shows a note to hosts.
Local check: `npm run dev`, then `npm run smoke:photos`.
