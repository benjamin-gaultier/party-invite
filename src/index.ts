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

const RSVPS: Rsvp[] = ["going", "maybe", "not_going"];
const LIMITS = { title: 120, description: 2000, address: 300, name: 40 };

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
  constructor(public status: 400 | 401 | 403 | 404, message: string) {
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
    .prepare("SELECT id, title, description, date, time, address FROM events WHERE id = ?")
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
  return { event, me: publicGuest(me), guests: results.map(publicGuest) };
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
  };
  const hostName = str(b.hostName, "hostName", LIMITS.name, true);
  const host = await insertGuest(c.env.DB, event.id, hostName, true);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO events (id, title, description, date, time, address) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(event.id, event.title, event.description, event.date, event.time, event.address),
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
    preview: { title: event.title, date: event.date, time: event.time, hostName: stats?.host, going: stats?.going ?? 0 },
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
  };
  await c.env.DB.prepare(
    "UPDATE events SET title = ?, description = ?, date = ?, time = ?, address = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(next.title, next.description, next.date, next.time, next.address, event.id)
    .run();
  return c.json(await fullEvent(c.env.DB, next, me));
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default app;
