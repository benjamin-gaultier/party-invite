// End-to-end check of the API against a running server.
// Usage: npm run dev (in another terminal), then: npm run smoke [baseUrl]
const base = process.argv[2] || "http://localhost:8787";
let failed = 0;

function check(label, cond) {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed++;
}

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const created = await call("/events", {
  method: "POST",
  body: { title: "Smoke party", date: "2030-06-01", time: "20:00", address: "1 Main St", hostName: "Host" },
});
check("create event -> 201", created.status === 201);
const { eventId, guest: host } = created.data;
check("event id is long and unguessable", eventId.length >= 20);

const preview = await call(`/events/${eventId}`);
check("anonymous GET returns preview only", preview.data.preview?.hostName === "Host" && !preview.data.guests);

const joined = await call(`/events/${eventId}/join`, { method: "POST", body: { name: "Guest" } });
check("join -> 201 with token", joined.status === 201 && joined.data.guest.token);
const guest = joined.data.guest;

const full = await call(`/events/${eventId}`, { token: guest.token });
check("returning guest sees full event", full.data.me?.name === "Guest" && full.data.guests.length === 2);

const rsvp = await call(`/events/${eventId}/rsvp`, { method: "PUT", body: { status: "going" }, token: guest.token });
check("rsvp going", rsvp.data.me?.rsvp === "going");
check("bad rsvp rejected", (await call(`/events/${eventId}/rsvp`, { method: "PUT", body: { status: "yes" }, token: guest.token })).status === 400);
check("rsvp without token rejected", (await call(`/events/${eventId}/rsvp`, { method: "PUT", body: { status: "going" } })).status === 401);

check("guest cannot edit event", (await call(`/events/${eventId}`, { method: "PATCH", body: { title: "x" }, token: guest.token })).status === 403);
const edited = await call(`/events/${eventId}`, { method: "PATCH", body: { title: "Renamed" }, token: host.token });
check("host can edit event", edited.data.event?.title === "Renamed");

const otherEvent = await call("/events", { method: "POST", body: { title: "Other", date: "2030-01-01", hostName: "X" } });
const cross = await call(`/events/${otherEvent.data.eventId}`, { token: guest.token });
check("token does not work on another event", !!cross.data.preview);

check("unknown event -> 404", (await call("/events/nope")).status === 404);
check("missing title -> 400", (await call("/events", { method: "POST", body: { date: "2030-01-01", hostName: "X" } })).status === 400);

const spa = await fetch(base + `/e/${eventId}`);
check("event URL serves the app", spa.status === 200 && (await spa.text()).includes("app.js"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
