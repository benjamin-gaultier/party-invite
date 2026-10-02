# Party Invite

A private mini social space for each real-life event. The host creates an event and
gets one link to share on WhatsApp, Instagram, etc. Guests open it, type their name
once and they're in. No accounts, no app. The browser remembers them, so opening the
link again goes straight into the event.

**MVP so far:** create event (title, date, time, address, details), unguessable share
link, join with a name, remembered return visits, guest list, RSVP (going / maybe /
can't go), map link for the address, host can edit details, "Your events" list on the
home page (stored in the browser).

**Next:** event chat, shared checklist/notes, song suggestions + Spotify link, link
previews and polish, photos later.

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

## Deploy to Cloudflare (first time)

```sh
npx wrangler login                       # opens the browser, log in to your Cloudflare account
npx wrangler d1 create party-invite      # prints a database_id
# paste that database_id into wrangler.jsonc (d1_databases[0].database_id)
npm run deploy                           # applies migrations to the remote DB, then deploys
```

The app is then live at `https://party-invite.<your-subdomain>.workers.dev`.
After that, `npm run deploy` is all you need.

### Deploying from CI instead

Create a Cloudflare API token with the **Edit Cloudflare Workers** template plus
**D1: Edit**, then set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the
environment and run `npm run deploy`. Alternatively, connect the GitHub repo in the
Cloudflare dashboard (Workers & Pages → Create → Import a repository) with deploy
command `npm run deploy`.

## API

| Method | Path | Auth | What |
| --- | --- | --- | --- |
| POST | `/api/events` | none | Create event `{title, date, time?, address?, description?, hostName}` → `{eventId, guest:{id, token}}` |
| GET | `/api/events/:id` | optional | With a valid token: `{event, me, guests}`. Without: `{preview}` for the join screen |
| POST | `/api/events/:id/join` | none | `{name}` → `{guest:{id, token}}` |
| PUT | `/api/events/:id/rsvp` | guest | `{status: going \| maybe \| not_going}` |
| PATCH | `/api/events/:id/me` | guest | Rename yourself `{name}` |
| PATCH | `/api/events/:id` | host | Edit event fields |
