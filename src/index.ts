import { Hono, type Context } from "hono";

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  // Spotify app credentials (Worker secrets). Without them the in-app "add a song" feature is off.
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  // Overridable for local tests against a fake Spotify (scripts/fake-spotify.mjs).
  SPOTIFY_API_URL?: string;
  SPOTIFY_ACCOUNTS_URL?: string;
};
type App = { Bindings: Env };

type EventRow = {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  address: string;
  theme: string;
  playlist_url: string;
  playlist_note: string;
  background_version?: number; // 0 or missing = no background picture
  color?: string; // '' or missing = default colors
};
type GuestRow = {
  id: string;
  event_id: string;
  name: string;
  is_host: number;
  rsvp: Rsvp | null;
  created_at: string;
};
type Rsvp = "going" | "maybe" | "not_going";
type CommentRow = { id: string; guest_id: string; name: string; body: string; created_at: string };

const RSVPS: Rsvp[] = ["going", "maybe", "not_going"];
const LIMITS = { title: 120, description: 2000, address: 300, name: 40, theme: 200, url: 500, note: 300, comment: 1000 };
const EVENT_COLS = "id, title, description, date, time, address, theme, playlist_url, playlist_note";

const app = new Hono<App>().basePath("/api");

// ---------- helpers ----------

// URL-safe random id. 16 bytes = 128 bits, so event links can't be guessed.
function randomId(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503, message: string) {
    super(message);
  }
}

// Field names as guests see them, for error messages (the UI is in French).
const LABELS: Record<string, string> = {
  title: "Titre",
  description: "Détails",
  date: "Date",
  time: "Heure",
  address: "Adresse",
  name: "Prénom",
  hostName: "Votre prénom",
  theme: "Thème",
  playlist_url: "Lien de la playlist",
  playlist_note: "Message de la playlist",
  body: "Commentaire",
};
const label = (field: string) => `Le champ « ${LABELS[field] ?? field} »`;

function str(value: unknown, field: string, max: number, required = false): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new HttpError(400, `${label(field)} est obligatoire`);
  if (s.length > max) throw new HttpError(400, `${label(field)} est trop long (max ${max} caractères)`);
  return s;
}

function dateStr(value: unknown): string {
  const s = str(value, "date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, "La date doit être au format AAAA-MM-JJ");
  return s;
}

function timeStr(value: unknown): string {
  const s = str(value, "time", 5);
  if (s && !/^\d{2}:\d{2}$/.test(s)) throw new HttpError(400, "L'heure doit être au format HH:MM");
  return s;
}

// Optional link (e.g. a Spotify playlist). Only http(s), so it is safe to put in an href.
function urlStr(value: unknown, field: string): string {
  const s = str(value, field, LIMITS.url);
  if (!s) return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new HttpError(400, `${label(field)} doit être un lien commençant par https://`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, `${label(field)} doit être un lien commençant par https://`);
  return url.toString();
}

async function body(c: Context<App>): Promise<Record<string, unknown>> {
  try {
    const json = await c.req.json();
    return json && typeof json === "object" ? json : {};
  } catch {
    throw new HttpError(400, "Requête invalide");
  }
}

async function getEvent(db: D1Database, id: string): Promise<EventRow> {
  const row = await db
    .prepare(`SELECT ${EVENT_COLS}, background_version, color FROM events WHERE id = ?`)
    .bind(id)
    .first<EventRow>();
  if (!row) throw new HttpError(404, "Événement introuvable");
  return row;
}

// The guest token travels as a Bearer header; returns null when missing or not
// a guest of this event.
async function currentGuest(c: Context<App>, eventId: string): Promise<GuestRow | null> {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  return c.env.DB.prepare(
    "SELECT id, event_id, name, is_host, rsvp, created_at FROM guests WHERE token_hash = ? AND event_id = ?",
  )
    .bind(await sha256(token), eventId)
    .first<GuestRow>();
}

async function requireGuest(c: Context<App>, eventId: string): Promise<GuestRow> {
  const guest = await currentGuest(c, eventId);
  if (!guest) throw new HttpError(401, "Rejoignez d'abord l'événement");
  return guest;
}

async function insertGuest(db: D1Database, eventId: string, name: string, isHost: boolean) {
  const id = randomId(9);
  const token = randomId(24);
  return {
    stmt: db
      .prepare("INSERT INTO guests (id, event_id, name, token_hash, is_host) VALUES (?, ?, ?, ?, ?)")
      .bind(id, eventId, name, await sha256(token), isHost ? 1 : 0),
    guest: { id, token },
  };
}

function publicComment(c: CommentRow) {
  return { id: c.id, guestId: c.guest_id, name: c.name, body: c.body, createdAt: c.created_at };
}

// Latest comments, oldest first. Names come from the guests table so renames show up.
async function listComments(db: D1Database, eventId: string) {
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT c.id, c.guest_id, g.name, c.body, c.created_at, c.rowid AS seq
         FROM comments c JOIN guests g ON g.id = c.guest_id
         WHERE c.event_id = ? ORDER BY c.rowid DESC LIMIT 200
       ) ORDER BY seq`,
    )
    .bind(eventId)
    .all<CommentRow>();
  return results.map(publicComment);
}

function publicGuest(g: GuestRow) {
  return { id: g.id, name: g.name, isHost: g.is_host === 1, rsvp: g.rsvp };
}

async function fullEvent(env: Env, event: EventRow, me: GuestRow) {
  const db = env.DB;
  const { results } = await db
    .prepare(
      "SELECT id, event_id, name, is_host, rsvp, created_at FROM guests WHERE event_id = ? ORDER BY is_host DESC, created_at",
    )
    .bind(event.id)
    .all<GuestRow>();
  return {
    event,
    me: publicGuest(me),
    guests: results.map(publicGuest),
    comments: await listComments(db, event.id),
    spotify: await spotifyStatus(env, event.id),
  };
}

// ---------- routes ----------

// Host creates an event and becomes its first guest.
app.post("/parties", async (c) => {
  const b = await body(c);
  const event: EventRow = {
    id: randomId(),
    title: str(b.title, "title", LIMITS.title, true),
    description: str(b.description, "description", LIMITS.description),
    date: dateStr(b.date),
    time: timeStr(b.time),
    address: str(b.address, "address", LIMITS.address),
    theme: str(b.theme, "theme", LIMITS.theme),
    playlist_url: urlStr(b.playlist_url, "playlist_url"),
    playlist_note: str(b.playlist_note, "playlist_note", LIMITS.note),
  };
  const hostName = str(b.hostName, "hostName", LIMITS.name, true);
  const host = await insertGuest(c.env.DB, event.id, hostName, true);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO events (${EVENT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.id,
      event.title,
      event.description,
      event.date,
      event.time,
      event.address,
      event.theme,
      event.playlist_url,
      event.playlist_note,
    ),
    host.stmt,
  ]);
  return c.json({ eventId: event.id, guest: host.guest }, 201);
});

// Without a valid guest token: a teaser for the join screen.
// With one: full event, guest list and who "me" is.
app.get("/parties/:id", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await currentGuest(c, event.id);
  if (me) return c.json(await fullEvent(c.env, event, me));
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT name FROM guests WHERE event_id = ?1 AND is_host = 1 LIMIT 1) AS host,
       (SELECT COUNT(*) FROM guests WHERE event_id = ?1 AND rsvp = 'going') AS going`,
  )
    .bind(event.id)
    .first<{ host: string | null; going: number }>();
  return c.json({
    preview: { title: event.title, date: event.date, time: event.time, theme: event.theme, background_version: event.background_version ?? 0, color: event.color ?? "", hostName: stats?.host, going: stats?.going ?? 0 },
  });
});

// Guest joins with just a name and gets a token back.
app.post("/parties/:id/join", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const name = str((await body(c)).name, "name", LIMITS.name, true);
  const { stmt, guest } = await insertGuest(c.env.DB, event.id, name, false);
  await stmt.run();
  return c.json({ guest }, 201);
});

app.put("/parties/:id/rsvp", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const status = (await body(c)).status;
  if (!RSVPS.includes(status as Rsvp)) throw new HttpError(400, "Réponse invalide (going, maybe ou not_going)");
  await c.env.DB.prepare("UPDATE guests SET rsvp = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, me.id)
    .run();
  return c.json(await fullEvent(c.env, event, { ...me, rsvp: status as Rsvp }));
});

// Rename yourself.
app.patch("/parties/:id/me", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const name = str((await body(c)).name, "name", LIMITS.name, true);
  await c.env.DB.prepare("UPDATE guests SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, me.id)
    .run();
  return c.json(await fullEvent(c.env, event, { ...me, name }));
});

// Host edits event details.
app.patch("/parties/:id", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut modifier l'événement");
  const b = await body(c);
  const next: EventRow = {
    ...event,
    title: "title" in b ? str(b.title, "title", LIMITS.title, true) : event.title,
    description: "description" in b ? str(b.description, "description", LIMITS.description) : event.description,
    date: "date" in b ? dateStr(b.date) : event.date,
    time: "time" in b ? timeStr(b.time) : event.time,
    address: "address" in b ? str(b.address, "address", LIMITS.address) : event.address,
    theme: "theme" in b ? str(b.theme, "theme", LIMITS.theme) : event.theme,
    playlist_url: "playlist_url" in b ? urlStr(b.playlist_url, "playlist_url") : event.playlist_url,
    playlist_note: "playlist_note" in b ? str(b.playlist_note, "playlist_note", LIMITS.note) : event.playlist_note,
  };
  await c.env.DB.prepare(
    `UPDATE events SET title = ?, description = ?, date = ?, time = ?, address = ?,
       theme = ?, playlist_url = ?, playlist_note = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(
      next.title,
      next.description,
      next.date,
      next.time,
      next.address,
      next.theme,
      next.playlist_url,
      next.playlist_note,
      event.id,
    )
    .run();
  // A different playlist means the Spotify connection must be redone for it.
  if (next.playlist_url !== event.playlist_url) {
    await c.env.DB.prepare("DELETE FROM spotify_links WHERE event_id = ?").bind(event.id).run();
  }
  return c.json(await fullEvent(c.env, next, me));
});

// ---------- comment wall ----------

app.get("/parties/:id/comments", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  await requireGuest(c, event.id);
  return c.json({ comments: await listComments(c.env.DB, event.id) });
});

app.post("/parties/:id/comments", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const text = str((await body(c)).body, "body", LIMITS.comment, true);
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE guest_id = ? AND created_at > datetime('now', '-1 minute')",
  )
    .bind(me.id)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 20) throw new HttpError(429, "Doucement ! Réessayez dans une minute");
  await c.env.DB.prepare("INSERT INTO comments (id, event_id, guest_id, body) VALUES (?, ?, ?, ?)")
    .bind(randomId(9), event.id, me.id, text)
    .run();
  return c.json({ comments: await listComments(c.env.DB, event.id) }, 201);
});

// Authors can delete their own comments; the host can delete any.
app.delete("/parties/:id/comments/:commentId", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const row = await c.env.DB.prepare("SELECT guest_id FROM comments WHERE id = ? AND event_id = ?")
    .bind(c.req.param("commentId"), event.id)
    .first<{ guest_id: string }>();
  if (!row) throw new HttpError(404, "Commentaire introuvable");
  if (row.guest_id !== me.id && me.is_host !== 1) throw new HttpError(403, "Vous ne pouvez supprimer que vos propres commentaires");
  await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(c.req.param("commentId")).run();
  return c.json({ comments: await listComments(c.env.DB, event.id) });
});

// ---------- colors ----------
// Must match COLORS in public/app.js.
const COLORS = ["", "metro", "bleu", "vert", "rose", "rouge", "orange", "nuit"];

app.put("/parties/:id/color", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut changer les couleurs");
  const color = (await body(c)).color;
  if (typeof color !== "string" || !COLORS.includes(color)) throw new HttpError(400, "Couleur inconnue");
  await c.env.DB.prepare("UPDATE events SET color = ?, updated_at = datetime('now') WHERE id = ?").bind(color, event.id).run();
  return c.json(await fullEvent(c.env, { ...event, color }, me));
});

// ---------- background picture ----------
// The browser resizes the photo before upload; we store the bytes in D1.

const BACKGROUND_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BACKGROUND_MAX_BYTES = 1_000_000;

// Public like the join screen: anyone with the event link can see it.
app.get("/parties/:id/background", async (c) => {
  const row = await c.env.DB.prepare("SELECT mime, data FROM event_backgrounds WHERE event_id = ?")
    .bind(c.req.param("id"))
    .first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) throw new HttpError(404, "Pas d'image de fond");
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mime,
      // URLs carry ?v=<version>, so a new picture gets a new URL.
      "Cache-Control": c.req.query("v") ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.put("/parties/:id/background", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut changer l'image de fond");
  const mime = (c.req.header("Content-Type") ?? "").split(";")[0].trim();
  if (!BACKGROUND_TYPES.includes(mime)) throw new HttpError(415, "Format d'image non pris en charge (JPEG, PNG ou WebP)");
  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) throw new HttpError(400, "Image vide");
  if (data.byteLength > BACKGROUND_MAX_BYTES) throw new HttpError(413, "Image trop lourde (1 Mo max)");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO event_backgrounds (event_id, mime, data) VALUES (?, ?, ?)").bind(event.id, mime, data),
    c.env.DB.prepare(
      "UPDATE events SET background_version = background_version + 1, updated_at = datetime('now') WHERE id = ?",
    ).bind(event.id),
  ]);
  return c.json(await fullEvent(c.env, await getEvent(c.env.DB, event.id), me));
});

app.delete("/parties/:id/background", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut changer l'image de fond");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM event_backgrounds WHERE event_id = ?").bind(event.id),
    c.env.DB.prepare("UPDATE events SET background_version = 0, updated_at = datetime('now') WHERE id = ?").bind(event.id),
  ]);
  return c.json(await fullEvent(c.env, { ...event, background_version: 0 }, me));
});

// ---------- Spotify: guests add songs to the host's playlist ----------
// The host connects their Spotify account once (OAuth). Guests then search and
// add tracks through our API, which calls Spotify with the host's token, so
// guests need no Spotify account.

type SpotifyLink = {
  event_id: string;
  guest_id: string;
  playlist_id: string;
  account_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
type SongRow = { id: string; guest_id: string; name: string; track_id: string; title: string; artists: string; image: string; created_at: string };

const SPOTIFY_SCOPES = "playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative";
const spotifyApi = (env: Env) => env.SPOTIFY_API_URL || "https://api.spotify.com/v1";
const spotifyAccounts = (env: Env) => env.SPOTIFY_ACCOUNTS_URL || "https://accounts.spotify.com";
const spotifyEnabled = (env: Env) => !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
const now = () => Math.floor(Date.now() / 1000);

function playlistIdFromUrl(url: string): string | null {
  const m = url.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function getLink(db: D1Database, eventId: string) {
  return db.prepare("SELECT * FROM spotify_links WHERE event_id = ?").bind(eventId).first<SpotifyLink>();
}

async function listSongs(db: D1Database, eventId: string) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.guest_id, g.name, s.track_id, s.title, s.artists, s.image, s.created_at
       FROM song_adds s JOIN guests g ON g.id = s.guest_id
       WHERE s.event_id = ? ORDER BY s.created_at DESC, s.rowid DESC LIMIT 100`,
    )
    .bind(eventId)
    .all<SongRow>();
  return results.map((r) => ({
    id: r.id,
    trackId: r.track_id,
    title: r.title,
    artists: r.artists,
    image: r.image,
    addedBy: r.name,
    guestId: r.guest_id,
    createdAt: r.created_at,
  }));
}

async function spotifyStatus(env: Env, eventId: string) {
  if (!spotifyEnabled(env)) return { enabled: false, connected: false, accountName: "", songs: [] };
  const link = await getLink(env.DB, eventId);
  return {
    enabled: true,
    connected: !!link,
    accountName: link?.account_name ?? "",
    songs: link ? await listSongs(env.DB, eventId) : [],
  };
}

async function tokenRequest(env: Env, params: Record<string, string>) {
  const res = await fetch(`${spotifyAccounts(env)}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    console.error("spotify token error", res.status, await res.text());
    return null;
  }
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

// Calls the Spotify API as the host, refreshing the access token when needed.
async function spotifyCall(env: Env, link: SpotifyLink, path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) =>
    fetch(spotifyApi(env) + path, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    });
  if (link.expires_at - 60 > now()) {
    const res = await send(link.access_token);
    if (res.status !== 401) return res;
  }
  const fresh = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: link.refresh_token });
  if (!fresh) throw new HttpError(502, "La connexion Spotify a expiré. L'hôte doit reconnecter Spotify.");
  link.access_token = fresh.access_token;
  link.expires_at = now() + fresh.expires_in;
  if (fresh.refresh_token) link.refresh_token = fresh.refresh_token;
  // During the OAuth callback the link isn't saved yet; this update is then a no-op.
  await env.DB.prepare("UPDATE spotify_links SET access_token = ?, refresh_token = ?, expires_at = ? WHERE event_id = ?")
    .bind(link.access_token, link.refresh_token, link.expires_at, link.event_id)
    .run();
  return send(link.access_token);
}

async function requireLink(c: Context<App>, eventId: string) {
  if (!spotifyEnabled(c.env)) throw new HttpError(503, "Spotify n'est pas configuré sur ce site");
  const link = await getLink(c.env.DB, eventId);
  if (!link) throw new HttpError(409, "L'hôte n'a pas encore connecté Spotify");
  return link;
}

type SpotifyTrack = { id: string; name: string; artists: { name: string }[]; album: { images: { url: string; width: number }[] } };
function trackSummary(t: SpotifyTrack) {
  const images = [...(t.album?.images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return {
    trackId: t.id,
    title: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    image: images[0]?.url ?? "",
  };
}

// Host starts connecting: we hand back Spotify's consent URL.
app.post("/parties/:id/spotify/connect", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut connecter Spotify");
  if (!spotifyEnabled(c.env)) throw new HttpError(503, "Spotify n'est pas configuré sur ce site");
  const state = randomId();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM spotify_states WHERE created_at < ?").bind(now() - 900),
    c.env.DB.prepare("INSERT INTO spotify_states (state, event_id, guest_id, created_at) VALUES (?, ?, ?, ?)").bind(
      state,
      event.id,
      me.id,
      now(),
    ),
  ]);
  const url = new URL(`${spotifyAccounts(c.env)}/authorize`);
  url.search = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: new URL("/api/spotify/callback", c.req.url).toString(),
    scope: SPOTIFY_SCOPES,
    state,
  }).toString();
  return c.json({ url: url.toString() });
});

// Spotify sends the host back here after they accept (or refuse).
app.get("/spotify/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const row = await c.env.DB.prepare("SELECT event_id, guest_id, created_at FROM spotify_states WHERE state = ?")
    .bind(state)
    .first<{ event_id: string; guest_id: string; created_at: number }>();
  if (!row || row.created_at < now() - 900) return c.redirect("/?spotify=expired");
  await c.env.DB.prepare("DELETE FROM spotify_states WHERE state = ?").bind(state).run();
  const back = (result: string) => c.redirect(`/e/${row.event_id}?spotify=${result}`);

  const code = c.req.query("code");
  if (!code || c.req.query("error")) return back("cancelled");
  const tokens = await tokenRequest(c.env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: new URL("/api/spotify/callback", c.req.url).toString(),
  });
  if (!tokens?.refresh_token) return back("error");

  const link: SpotifyLink = {
    event_id: row.event_id,
    guest_id: row.guest_id,
    playlist_id: "",
    account_name: "",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: now() + tokens.expires_in,
  };
  const meRes = await spotifyCall(c.env, link, "/me");
  if (meRes.status === 403) return back("not_allowed"); // account not in the app's User Management list
  if (!meRes.ok) return back("error");
  const profile = (await meRes.json()) as { id: string; display_name?: string };
  link.account_name = profile.display_name || profile.id;

  // Use the playlist already on the event if this account can edit it, otherwise create one.
  const event = await getEvent(c.env.DB, row.event_id);
  const existing = playlistIdFromUrl(event.playlist_url);
  if (existing) {
    const pl = await spotifyCall(c.env, link, `/playlists/${existing}?fields=owner(id),collaborative`);
    const info = pl.ok ? ((await pl.json()) as { owner?: { id: string }; collaborative?: boolean }) : null;
    if (info && (info.owner?.id === profile.id || info.collaborative)) link.playlist_id = existing;
    else return back("not_owner");
  } else {
    const created = await spotifyCall(c.env, link, "/me/playlists", {
      method: "POST",
      body: JSON.stringify({ name: event.title, public: true, description: "Playlist de la soirée, ajoutez vos chansons !" }),
    });
    if (!created.ok) return back("error");
    link.playlist_id = ((await created.json()) as { id: string }).id;
    await c.env.DB.prepare("UPDATE events SET playlist_url = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(`https://open.spotify.com/playlist/${link.playlist_id}`, event.id)
      .run();
  }

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO spotify_links
       (event_id, guest_id, playlist_id, account_name, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(link.event_id, link.guest_id, link.playlist_id, link.account_name, link.access_token, link.refresh_token, link.expires_at)
    .run();
  return back("connected");
});

app.delete("/parties/:id/spotify", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Seul l'hôte peut déconnecter Spotify");
  await c.env.DB.prepare("DELETE FROM spotify_links WHERE event_id = ?").bind(event.id).run();
  return c.json(await fullEvent(c.env, event, me));
});

app.get("/parties/:id/spotify/search", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  await requireGuest(c, event.id);
  const q = str(c.req.query("q"), "q", 100, true);
  const link = await requireLink(c, event.id);
  const res = await spotifyCall(c.env, link, `/search?${new URLSearchParams({ q, type: "track", limit: "10", market: "FR" })}`);
  if (!res.ok) throw new HttpError(502, "La recherche Spotify ne répond pas, réessayez");
  const data = (await res.json()) as { tracks?: { items: SpotifyTrack[] } };
  return c.json({ tracks: (data.tracks?.items ?? []).filter(Boolean).map(trackSummary) });
});

app.post("/parties/:id/spotify/songs", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const trackId = str((await body(c)).trackId, "trackId", 40, true);
  if (!/^[A-Za-z0-9]{10,40}$/.test(trackId)) throw new HttpError(400, "Chanson invalide");
  const link = await requireLink(c, event.id);

  const dup = await c.env.DB.prepare("SELECT 1 FROM song_adds WHERE event_id = ? AND track_id = ?").bind(event.id, trackId).first();
  if (dup) throw new HttpError(409, "Cette chanson est déjà dans la playlist");
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM song_adds WHERE guest_id = ? AND created_at > datetime('now', '-1 hour')",
  )
    .bind(me.id)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, "Ça fait beaucoup de chansons ! Réessayez plus tard");

  // Look the track up ourselves rather than trusting the title sent by the browser.
  const t = await spotifyCall(c.env, link, `/tracks/${trackId}?market=FR`);
  if (t.status === 404 || t.status === 400) throw new HttpError(400, "Chanson introuvable");
  if (!t.ok) throw new HttpError(502, "Spotify ne répond pas, réessayez");
  const track = trackSummary((await t.json()) as SpotifyTrack);

  const added = await spotifyCall(c.env, link, `/playlists/${link.playlist_id}/items`, {
    method: "POST",
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
  if (added.status === 403)
    throw new HttpError(502, "Spotify refuse l'ajout. L'hôte doit reconnecter Spotify avec le compte propriétaire de la playlist.");
  if (!added.ok) throw new HttpError(502, "Spotify n'a pas pu ajouter la chanson, réessayez");

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO song_adds (id, event_id, guest_id, track_id, title, artists, image) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(randomId(9), event.id, me.id, trackId, track.title, track.artists, track.image)
    .run();
  return c.json({ songs: await listSongs(c.env.DB, event.id) }, 201);
});

app.notFound((c) => c.json({ error: "Introuvable" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Une erreur est survenue" }, 500);
});

export default app;
