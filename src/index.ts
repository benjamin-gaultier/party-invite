import { Hono, type Context } from "hono";

type Env = { DB: D1Database; ASSETS: Fetcher };
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
  constructor(public status: 400 | 401 | 403 | 404 | 429, message: string) {
    super(message);
  }
}

function str(value: unknown, field: string, max: number, required = false): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

function dateStr(value: unknown): string {
  const s = str(value, "date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, "date must be YYYY-MM-DD");
  return s;
}

function timeStr(value: unknown): string {
  const s = str(value, "time", 5);
  if (s && !/^\d{2}:\d{2}$/.test(s)) throw new HttpError(400, "time must be HH:MM");
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
    throw new HttpError(400, `${field} must be a link starting with https://`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, `${field} must be a link starting with https://`);
  return url.toString();
}

async function body(c: Context<App>): Promise<Record<string, unknown>> {
  try {
    const json = await c.req.json();
    return json && typeof json === "object" ? json : {};
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function getEvent(db: D1Database, id: string): Promise<EventRow> {
  const row = await db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`)
    .bind(id)
    .first<EventRow>();
  if (!row) throw new HttpError(404, "Event not found");
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
  if (!guest) throw new HttpError(401, "Join the event first");
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

async function fullEvent(db: D1Database, event: EventRow, me: GuestRow) {
  const { results } = await db
    .prepare(
      "SELECT id, event_id, name, is_host, rsvp, created_at FROM guests WHERE event_id = ? ORDER BY is_host DESC, created_at",
    )
    .bind(event.id)
    .all<GuestRow>();
  return { event, me: publicGuest(me), guests: results.map(publicGuest), comments: await listComments(db, event.id) };
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
  if (me) return c.json(await fullEvent(c.env.DB, event, me));
  const stats = await c.env.DB.prepare(
    `SELECT
       (SELECT name FROM guests WHERE event_id = ?1 AND is_host = 1 LIMIT 1) AS host,
       (SELECT COUNT(*) FROM guests WHERE event_id = ?1 AND rsvp = 'going') AS going`,
  )
    .bind(event.id)
    .first<{ host: string | null; going: number }>();
  return c.json({
    preview: { title: event.title, date: event.date, time: event.time, theme: event.theme, hostName: stats?.host, going: stats?.going ?? 0 },
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
  if (!RSVPS.includes(status as Rsvp)) throw new HttpError(400, "status must be going, maybe or not_going");
  await c.env.DB.prepare("UPDATE guests SET rsvp = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, me.id)
    .run();
  return c.json(await fullEvent(c.env.DB, event, { ...me, rsvp: status as Rsvp }));
});

// Rename yourself.
app.patch("/parties/:id/me", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  const name = str((await body(c)).name, "name", LIMITS.name, true);
  await c.env.DB.prepare("UPDATE guests SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, me.id)
    .run();
  return c.json(await fullEvent(c.env.DB, event, { ...me, name }));
});

// Host edits event details.
app.patch("/parties/:id", async (c) => {
  const event = await getEvent(c.env.DB, c.req.param("id"));
  const me = await requireGuest(c, event.id);
  if (me.is_host !== 1) throw new HttpError(403, "Only the host can edit the event");
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
  return c.json(await fullEvent(c.env.DB, next, me));
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
  if ((recent?.n ?? 0) >= 20) throw new HttpError(429, "Slow down a little, try again in a minute");
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
  if (!row) throw new HttpError(404, "Comment not found");
  if (row.guest_id !== me.id && me.is_host !== 1) throw new HttpError(403, "You can only delete your own comments");
  await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(c.req.param("commentId")).run();
  return c.json({ comments: await listComments(c.env.DB, event.id) });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default app;
