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

## Deploy to Cloudflare

The production D1 database `party-invite` already exists (its id is in `wrangler.jsonc`)
and has migration `0001_init.sql` applied.

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
| POST | `/api/events` | none | Create event `{title, date, time?, address?, description?, hostName}` → `{eventId, guest:{id, token}}` |
| GET | `/api/events/:id` | optional | With a valid token: `{event, me, guests}`. Without: `{preview}` for the join screen |
| POST | `/api/events/:id/join` | none | `{name}` → `{guest:{id, token}}` |
| PUT | `/api/events/:id/rsvp` | guest | `{status: going \| maybe \| not_going}` |
| PATCH | `/api/events/:id/me` | guest | Rename yourself `{name}` |
| PATCH | `/api/events/:id` | host | Edit event fields |
