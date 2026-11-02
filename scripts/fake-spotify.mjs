// A tiny stand-in for Spotify's accounts + Web API, for local tests only.
// Usage: node scripts/fake-spotify.mjs  (listens on :8788)
// then: npx wrangler dev --var SPOTIFY_CLIENT_ID:test --var SPOTIFY_CLIENT_SECRET:test \
//   --var SPOTIFY_API_URL:http://localhost:8788/v1 --var SPOTIFY_ACCOUNTS_URL:http://localhost:8788
import http from "node:http";

const added = [];
const tracks = {
  "4uLU6hMCjMI75M1A2tKUQC": { name: "La Vie en rose", artist: "Édith Piaf" },
  "1h2xVEoJORqrg71HocgqXd": { name: "Alors on danse", artist: "Stromae" },
};
const track = (id) => ({
  id,
  name: tracks[id].name,
  artists: [{ name: tracks[id].artist }],
  album: { images: [{ url: "https://i.scdn.co/image/test", width: 64 }] },
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = url.pathname;

    if (p === "/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "test-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (p === "/api/token") return json(200, { access_token: "tok", refresh_token: "ref", expires_in: 3600 });
    if (p === "/__added") return json(200, added);
    if (req.headers.authorization !== "Bearer tok") return json(401, { error: "bad token" });
    if (p === "/v1/me") return json(200, { id: "banu", display_name: "Banu" });
    if (p === "/v1/me/playlists" && req.method === "POST") return json(201, { id: "newplaylist123" });
    if (p.startsWith("/v1/playlists/") && p.endsWith("/items") && req.method === "POST") {
      added.push(...JSON.parse(body).uris);
      return json(201, { snapshot_id: "x" });
    }
    if (p.startsWith("/v1/playlists/")) return json(200, { owner: { id: p.includes("someoneelse") ? "other" : "banu" }, collaborative: false });
    if (p === "/v1/search") {
      const q = url.searchParams.get("q").toLowerCase();
      const items = Object.keys(tracks).filter((id) => (tracks[id].name + tracks[id].artist).toLowerCase().includes(q)).map(track);
      return json(200, { tracks: { items } });
    }
    if (p.startsWith("/v1/tracks/")) {
      const id = p.split("/").pop();
      return tracks[id] ? json(200, track(id)) : json(404, { error: "not found" });
    }
    json(404, { error: "unknown " + p });
  })
  .listen(8788, () => console.log("fake spotify on :8788"));
