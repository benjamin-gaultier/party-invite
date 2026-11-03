// End-to-end check of the photo album against a running server (npm run dev).
// Usage: npm run smoke:photos [baseUrl]
const base = process.argv[2] || "http://localhost:8787";
let failed = 0;
const check = (label, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed++;
};

async function call(path, { method = "GET", body, token, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(base + "/api" + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get("Content-Type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
}

const jpeg = (n) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)])], { type: "image/jpeg" });
function photoForm({ photo = jpeg(5000), thumb = jpeg(500), width = 1600, height = 1200 } = {}) {
  const f = new FormData();
  f.append("photo", photo, "p.jpg");
  f.append("thumb", thumb, "t.jpg");
  f.append("width", String(width));
  f.append("height", String(height));
  return f;
}

const today = new Date().toISOString().slice(0, 10);
const created = await call("/parties", { method: "POST", body: { title: "Photo party", date: "2031-01-01", hostName: "Host" } });
const { eventId, guest: host } = created.data;
const guest = (await call(`/parties/${eventId}/join`, { method: "POST", body: { name: "Guest" } })).data.guest;
const other = (await call(`/parties/${eventId}/join`, { method: "POST", body: { name: "Other" } })).data.guest;

let full = await call(`/parties/${eventId}`, { token: guest.token });
check("album enabled and empty", full.data.photos?.enabled === true && full.data.photos.photos.length === 0 && full.data.photos.canUpload);

const up = await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: guest.token });
check("guest uploads a photo -> 201", up.status === 201 && up.data.photos.photos[0]?.name === "Guest");
const photoId = up.data.id;
check("upload without token rejected", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm() })).status === 401);
check("non-image rejected", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm({ photo: new Blob(["<svg/>"], { type: "image/jpeg" }) }), token: guest.token })).status === 415);
check("PNG type rejected", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm({ photo: new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }) }), token: guest.token })).status === 415);
check("too big rejected", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm({ photo: jpeg(2_100_000) }), token: guest.token })).status === 413);
check("bad size rejected", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm({ width: "abc" }), token: guest.token })).status === 400);

const img = await call(`/parties/${eventId}/photos/${photoId}`);
check("photo served without token", img.status === 200 && img.headers.get("Content-Type") === "image/jpeg" && img.data.length === 5004);
const th = await call(`/parties/${eventId}/photos/${photoId}?thumb=1`);
check("thumbnail served", th.status === 200 && th.data.length === 504);
check("download sets attachment", (await call(`/parties/${eventId}/photos/${photoId}?download=1`)).headers.get("Content-Disposition")?.startsWith("attachment"));
check("photo of another event is 404", (await call(`/parties/nope/photos/${photoId}`)).status === 404);

check("other guest cannot delete it", (await call(`/parties/${eventId}/photos/${photoId}`, { method: "DELETE", token: other.token })).status === 403);
const up2 = await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: other.token });
const del = await call(`/parties/${eventId}/photos/${up2.data.id}`, { method: "DELETE", token: other.token });
check("author deletes own photo", del.status === 200 && del.data.photos.photos.length === 1);
check("deleted photo no longer served", (await call(`/parties/${eventId}/photos/${up2.data.id}`)).status === 404);

// Party-day setting
check("guest cannot change the setting", (await call(`/parties/${eventId}/photos-settings`, { method: "PUT", body: { partyDayOnly: true }, token: guest.token })).status === 403);
const set = await call(`/parties/${eventId}/photos-settings`, { method: "PUT", body: { partyDayOnly: true }, token: host.token });
check("host turns on party-day only", set.data.photos?.partyDayOnly === true && set.data.photos.canUpload === true);
full = await call(`/parties/${eventId}`, { token: guest.token });
check("guest can't upload before the day", full.data.photos.canUpload === false);
check("upload before the day -> 403", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: guest.token })).status === 403);
check("host still can", (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: host.token })).status === 201);
await call(`/parties/${eventId}`, { method: "PATCH", body: { date: today }, token: host.token });
check("on the day guests can upload", (await call(`/parties/${eventId}`, { token: guest.token })).data.photos.canUpload === true);

// Host deletes any photo
const hostDel = await call(`/parties/${eventId}/photos/${photoId}`, { method: "DELETE", token: host.token });
check("host deletes a guest's photo", hostDel.status === 200 && hostDel.data.photos.photos.length === 1);

// Merging a duplicate moves their photos; removing a guest removes theirs.
const dup = (await call(`/parties/${eventId}/join`, { method: "POST", body: { name: "Guest" } })).data.guest;
const dupPhoto = (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: dup.token })).data.id;
const dupId = (await call(`/parties/${eventId}`, { token: dup.token })).data.me.id;
const guestId = (await call(`/parties/${eventId}`, { token: guest.token })).data.me.id;
const merged = await call(`/parties/${eventId}/guests/${dupId}?into=${guestId}`, { method: "DELETE", token: host.token });
check("merge moves photos", merged.data.photos.photos.find((p) => p.id === dupPhoto)?.guestId === guestId);
const otherPhoto = (await call(`/parties/${eventId}/photos`, { method: "POST", form: photoForm(), token: other.token })).data.id;
const otherId = (await call(`/parties/${eventId}`, { token: other.token })).data.me.id;
await call(`/parties/${eventId}/guests/${otherId}`, { method: "DELETE", token: host.token });
check("removed guest's photos are gone", (await call(`/parties/${eventId}/photos/${otherPhoto}`)).status === 404);

// Deleting the event removes everything
await call(`/parties/${eventId}`, { method: "DELETE", token: host.token });
check("photos gone with the event", (await call(`/parties/${eventId}/photos/${dupPhoto}`)).status === 404);

console.log(failed ? `\n${failed} check(s) failed` : "\nall photo checks passed");
process.exit(failed ? 1 : 0);
