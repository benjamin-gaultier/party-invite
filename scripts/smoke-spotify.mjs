// End-to-end check of "guests add songs from the app" against wrangler dev + scripts/fake-spotify.mjs.
const base = process.argv[2] || "http://localhost:8787";
const fake = "http://localhost:8788";
let failed = 0;
const check = (label, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed++;
};
async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
// Follows the OAuth dance by hand: our connect URL -> fake authorize -> our callback.
async function connect(eventId, token) {
  const { data } = await call(`/parties/${eventId}/spotify/connect`, { method: "POST", token });
  const toCallback = (await fetch(data.url, { redirect: "manual" })).headers.get("location");
  return (await fetch(toCallback, { redirect: "manual" })).headers.get("location");
}

const { data: created } = await call("/parties", { method: "POST", body: { title: "Soirée", date: "2030-06-01", hostName: "Banu" } });
const { eventId, guest: host } = created;
const { data: joined } = await call(`/parties/${eventId}/join`, { method: "POST", body: { name: "Benji" } });
const guest = joined.guest;

let full = (await call(`/parties/${eventId}`, { token: guest.token })).data;
check("spotify enabled, not connected yet", full.spotify.enabled && !full.spotify.connected);
check("guest cannot connect spotify", (await call(`/parties/${eventId}/spotify/connect`, { method: "POST", token: guest.token })).status === 403);
check("search before connecting -> 409", (await call(`/parties/${eventId}/spotify/search?q=piaf`, { token: guest.token })).status === 409);

const landed = await connect(eventId, host.token);
check("callback lands back on the event", landed === `/e/${eventId}?spotify=connected`);
full = (await call(`/parties/${eventId}`, { token: guest.token })).data;
check("connected, playlist created and linked", full.spotify.connected && full.event.playlist_url === "https://open.spotify.com/playlist/newplaylist123");
check("account name shown", full.spotify.accountName === "Banu");

const search = await call(`/parties/${eventId}/spotify/search?q=piaf`, { token: guest.token });
check("guest searches songs", search.data.tracks?.[0]?.title === "La Vie en rose" && search.data.tracks[0].artists === "Édith Piaf");
const add = await call(`/parties/${eventId}/spotify/songs`, { method: "POST", body: { trackId: "4uLU6hMCjMI75M1A2tKUQC" }, token: guest.token });
check("guest adds a song", add.status === 201 && add.data.songs[0].addedBy === "Benji");
const sent = await (await fetch(fake + "/__added")).json();
check("song was sent to the Spotify playlist", sent.includes("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
check("same song twice -> 409", (await call(`/parties/${eventId}/spotify/songs`, { method: "POST", body: { trackId: "4uLU6hMCjMI75M1A2tKUQC" }, token: guest.token })).status === 409);
check("unknown track -> 400", (await call(`/parties/${eventId}/spotify/songs`, { method: "POST", body: { trackId: "0000000000000000000000" }, token: guest.token })).status === 400);
check("bad track id -> 400", (await call(`/parties/${eventId}/spotify/songs`, { method: "POST", body: { trackId: "../me" }, token: guest.token })).status === 400);
check("songs need a token", (await call(`/parties/${eventId}/spotify/search?q=x`)).status === 401);

// An existing playlist owned by someone else is refused.
const { data: other } = await call("/parties", {
  method: "POST",
  body: { title: "Autre", date: "2030-06-01", hostName: "Banu", playlist_url: "https://open.spotify.com/playlist/someoneelse1" },
});
check("playlist owned by another account -> not_owner", (await connect(other.eventId, other.guest.token)).endsWith("spotify=not_owner"));

// Changing the playlist link drops the connection.
await call(`/parties/${eventId}`, { method: "PATCH", body: { playlist_url: "https://open.spotify.com/playlist/xyz" }, token: host.token });
check("new playlist link needs reconnecting", !(await call(`/parties/${eventId}`, { token: host.token })).data.spotify.connected);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
