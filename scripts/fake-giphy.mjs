// A tiny stand-in for GIPHY's search API, for local tests only.
// Usage: node scripts/fake-giphy.mjs  (listens on :8789)
// then: npx wrangler dev --var GIPHY_API_KEY:test --var GIPHY_API_URL:http://localhost:8789/v1
import http from "node:http";

const ids = ["fakeDance1", "fakeParty2", "fakeParis3", "fakeCheers4", "fakeLol5", "fakeWow6"];
const gif = (id, title) => ({
  id,
  title,
  images: { fixed_width_small: { webp: `https://media.giphy.com/media/${id}/100w.webp`, width: "100", height: "80" } },
});

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("api_key") !== "test") {
      res.writeHead(401).end();
      return;
    }
    const q = url.searchParams.get("q") || "";
    let data = [];
    if (url.pathname === "/v1/gifs/trending") data = ids.map((id) => gif(id, `trending ${id}`));
    else if (url.pathname === "/v1/gifs/search") data = q === "rien" ? [] : ids.slice(0, 4).map((id) => gif(id, `${q} ${id}`));
    data.push({ id: "bad/id", title: "x", images: { fixed_width_small: { webp: "https://x" } } }); // must be filtered out
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data }));
  })
  .listen(8789, () => console.log("fake GIPHY on :8789"));
