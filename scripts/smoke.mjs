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

const created = await call("/parties", {
  method: "POST",
  body: { title: "Smoke party", date: "2030-06-01", time: "20:00", address: "1 Main St", hostName: "Host" },
});
check("create event -> 201", created.status === 201);
const { eventId, guest: host } = created.data;
check("event id is long and unguessable", eventId.length >= 20);

const preview = await call(`/parties/${eventId}`);
check("anonymous GET returns preview only", preview.data.preview?.hostName === "Host" && !preview.data.guests);

const joined = await call(`/parties/${eventId}/join`, { method: "POST", body: { name: "Guest" } });
check("join -> 201 with token", joined.status === 201 && joined.data.guest.token);
const guest = joined.data.guest;

const full = await call(`/parties/${eventId}`, { token: guest.token });
check("returning guest sees full event", full.data.me?.name === "Guest" && full.data.guests.length === 2);

const rsvp = await call(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: "going" }, token: guest.token });
check("rsvp going", rsvp.data.me?.rsvp === "going");
check("bad rsvp rejected", (await call(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: "yes" }, token: guest.token })).status === 400);
check("rsvp without token rejected", (await call(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: "going" } })).status === 401);

check("guest cannot edit event", (await call(`/parties/${eventId}`, { method: "PATCH", body: { title: "x" }, token: guest.token })).status === 403);
const edited = await call(`/parties/${eventId}`, { method: "PATCH", body: { title: "Renamed" }, token: host.token });
check("host can edit event", edited.data.event?.title === "Renamed");

const themed = await call(`/parties/${eventId}`, {
  method: "PATCH",
  body: { theme: "Paris metro stops", playlist_url: "https://open.spotify.com/playlist/abc123", playlist_note: "Add French songs" },
  token: host.token,
});
check("host sets theme and playlist", themed.data.event?.theme === "Paris metro stops" && themed.data.event?.playlist_url.includes("spotify"));
check("bad playlist link rejected", (await call(`/parties/${eventId}`, { method: "PATCH", body: { playlist_url: "javascript:alert(1)" }, token: host.token })).status === 400);
check("preview shows theme", (await call(`/parties/${eventId}`)).data.preview?.theme === "Paris metro stops");

const posted = await call(`/parties/${eventId}/comments`, { method: "POST", body: { body: "Bonjour !" }, token: guest.token });
check("guest posts a comment", posted.status === 201 && posted.data.comments.at(-1)?.name === "Guest");
await call(`/parties/${eventId}/comments`, { method: "POST", body: { body: "Salut" }, token: host.token });
const listed = await call(`/parties/${eventId}/comments`, { token: guest.token });
check("comments listed oldest first", listed.data.comments.map((c) => c.body).join() === "Bonjour !,Salut");
check("full event includes comments", (await call(`/parties/${eventId}`, { token: guest.token })).data.comments?.length === 2);
check("comments need a token", (await call(`/parties/${eventId}/comments`)).status === 401);
check("empty comment rejected", (await call(`/parties/${eventId}/comments`, { method: "POST", body: { body: " " }, token: guest.token })).status === 400);
const hostComment = listed.data.comments[1];
check("guest cannot delete host's comment", (await call(`/parties/${eventId}/comments/${hostComment.id}`, { method: "DELETE", token: guest.token })).status === 403);
const del = await call(`/parties/${eventId}/comments/${listed.data.comments[0].id}`, { method: "DELETE", token: host.token });
check("host can delete any comment", del.status === 200 && del.data.comments.length === 1);

// GIFs: only when the Worker has a GIPHY key (run with scripts/fake-giphy.mjs to test them).
const gifsOn = (await call(`/parties/${eventId}`, { token: guest.token })).data.gifs;
if (gifsOn) {
  const trending = await call(`/parties/${eventId}/gifs`, { token: guest.token });
  check("gif trending works and drops bad ids", trending.status === 200 && trending.data.gifs.length > 0 && trending.data.gifs.every((g) => /^[A-Za-z0-9]+$/.test(g.id)));
  const found = await call(`/parties/${eventId}/gifs?q=danse`, { token: guest.token });
  check("gif search works", found.status === 200 && found.data.gifs[0]?.preview.startsWith("https://"));
} else {
  check("gif search off without key", (await call(`/parties/${eventId}/gifs?q=x`, { token: guest.token })).status === 503);
}
check("gif search needs a token", (await call(`/parties/${eventId}/gifs?q=x`)).status === 401);
const gifComment = await call(`/parties/${eventId}/comments`, { method: "POST", body: { body: "@Host trop bien 🎉\n[gif:abc123]" }, token: guest.token });
check("comment with mention, emoji and gif is stored as-is", gifComment.data.comments.at(-1)?.body === "@Host trop bien 🎉\n[gif:abc123]");

// Background picture
const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const putBg = (token, type = "image/jpeg", bytes = img) =>
  fetch(`${base}/api/parties/${eventId}/background`, { method: "PUT", headers: { "Content-Type": type, Authorization: `Bearer ${token}` }, body: bytes });
check("guest cannot set background", (await putBg(guest.token)).status === 403);
check("non-image background rejected", (await putBg(host.token, "text/html")).status === 415);
check("huge background rejected", (await putBg(host.token, "image/jpeg", new Uint8Array(1_100_000))).status === 413);
const bgSet = await putBg(host.token);
const bgData = await bgSet.json();
check("host sets background", bgSet.status === 200 && bgData.event.background_version === 1);
const bgGet = await fetch(`${base}/api/parties/${eventId}/background?v=1`);
const bgBytes = new Uint8Array(await bgGet.arrayBuffer());
check("background served as image", bgGet.headers.get("content-type") === "image/jpeg" && bgBytes.length === img.length && bgBytes[0] === 0xff);
check("join preview knows the background", (await call(`/parties/${eventId}`)).data.preview?.background_version === 1);
check("second upload bumps version", (await (await putBg(host.token)).json()).event.background_version === 2);
const bgDel = await call(`/parties/${eventId}/background`, { method: "DELETE", token: host.token });
check("host removes background", bgDel.data.event?.background_version === 0 && (await fetch(`${base}/api/parties/${eventId}/background`)).status === 404);

// Co-hosts
check("guest cannot add a co-host", (await call(`/parties/${eventId}/guests/${host.id}/host`, { method: "PUT", body: { isHost: false }, token: guest.token })).status === 403);
check("host cannot change own role", (await call(`/parties/${eventId}/guests/${host.id}/host`, { method: "PUT", body: { isHost: false }, token: host.token })).status === 400);
const promoted = await call(`/parties/${eventId}/guests/${guest.id}/host`, { method: "PUT", body: { isHost: true }, token: host.token });
check("host makes a co-host", promoted.data.guests?.find((g) => g.id === guest.id)?.isHost === true);
check("co-host can change colors", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: "vert" }, token: guest.token })).status === 200);
check("preview lists both hosts", (await call(`/parties/${eventId}`)).data.preview?.hostName?.includes(" et "));
check("unknown guest -> 404", (await call(`/parties/${eventId}/guests/nope/host`, { method: "PUT", body: { isHost: true }, token: host.token })).status === 404);
check("co-host removed", (await call(`/parties/${eventId}/guests/${guest.id}/host`, { method: "PUT", body: { isHost: false }, token: host.token })).data.guests?.find((g) => g.id === guest.id)?.isHost === false);

// Event colors
check("guest cannot change colors", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: "metro" }, token: guest.token })).status === 403);
check("unknown color rejected", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: "#ff0000" }, token: host.token })).status === 400);
const colored = await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: "metro" }, token: host.token });
check("host sets colors", colored.data.event?.color === "metro");
check("join preview has the color", (await call(`/parties/${eventId}`)).data.preview?.color === "metro");
const custom = JSON.stringify({ accent: "#ff0066", bg: "#101010", card: "#202020" });
check("host sets custom colors", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: custom }, token: host.token })).data.event?.color === custom);
check("bad custom colors rejected", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: JSON.stringify({ accent: "red", bg: "#101010", card: "#202020" }) }, token: host.token })).status === 400);
check("extra custom keys rejected", (await call(`/parties/${eventId}/color`, { method: "PUT", body: { color: JSON.stringify({ accent: "#ff0066", bg: "#101010", card: "#202020", x: "#000000" }) }, token: host.token })).status === 400);

const otherEvent = await call("/parties", { method: "POST", body: { title: "Other", date: "2030-01-01", hostName: "X" } });
const cross = await call(`/parties/${otherEvent.data.eventId}`, { token: guest.token });
check("token does not work on another event", !!cross.data.preview);

// My events + deletion
const mine = await call("/mine", { method: "POST", body: { tokens: [host.token, otherEvent.data.guest.token, "bogus"] } });
check("my events lists hosted events", mine.data.events?.length === 2 && mine.data.events.every((e) => e.isHost));
const mineGuest = await call("/mine", { method: "POST", body: { tokens: [guest.token] } });
check("my events marks joined events", mineGuest.data.events?.[0]?.id === eventId && mineGuest.data.events[0].isHost === false && mineGuest.data.events[0].rsvp === "going");
check("my events rejects bad body", (await call("/mine", { method: "POST", body: { tokens: "x" } })).status === 400);
check("guest cannot delete event", (await call(`/parties/${eventId}`, { method: "DELETE", token: guest.token })).status === 403);
check("delete without token rejected", (await call(`/parties/${eventId}`, { method: "DELETE" })).status === 401);
await call(`/parties/${eventId}/guests/${guest.id}/host`, { method: "PUT", body: { isHost: true }, token: host.token });
const removed = await call(`/parties/${eventId}`, { method: "DELETE", token: guest.token });
check("co-host deletes event", removed.status === 200 && removed.data.deleted === true);
check("deleted event -> 404", (await call(`/parties/${eventId}`, { token: host.token })).status === 404);
check("deleted event gone from my events", (await call("/mine", { method: "POST", body: { tokens: [host.token, guest.token] } })).data.events?.length === 0);
check("other event untouched", (await call(`/parties/${otherEvent.data.eventId}`, { token: otherEvent.data.guest.token })).data.event?.title === "Other");

check("unknown event -> 404", (await call("/parties/nope")).status === 404);
check("missing title -> 400", (await call("/parties", { method: "POST", body: { date: "2030-01-01", hostName: "X" } })).status === 400);

const spa = await fetch(base + `/e/${eventId}`);
check("event URL serves the app", spa.status === 200 && (await spa.text()).includes("app.js"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
