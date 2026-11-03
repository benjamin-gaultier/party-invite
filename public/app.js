// Party Invite frontend: no framework, no build step.
// Routes: "/" (create an event), "/mes-evenements" (hosted + joined events) and "/e/:id" (an event).

const app = document.getElementById("app");
const STORE_KEY = "party-invite:v1";

// ---------- local identity ----------
// Per event we keep { guestId, token, name, title, date, time, isHost }. The token is what
// lets a returning guest skip the name step; the rest powers "Your events".

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { events: {}, lastName: "" };
  } catch {
    return { events: {}, lastName: "" };
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or storage blocked: the app still works for this visit.
  }
}

function getIdentity(eventId) {
  return loadStore().events[eventId] || null;
}

function setIdentity(eventId, data) {
  const store = loadStore();
  store.events[eventId] = { ...store.events[eventId], ...data };
  if (data.name) store.lastName = data.name;
  saveStore(store);
}

function forgetIdentity(eventId) {
  const store = loadStore();
  delete store.events[eventId];
  saveStore(store);
}

// ---------- api ----------

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion, ou désactivez votre bloqueur de pubs pour ce site.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- tiny view helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function toast(message, ms = 2500) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), ms);
}

function formatWhen(date, time) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: new Date().getFullYear() === y ? undefined : "numeric",
  });
  if (!time) return day;
  const [hh, mm] = time.split(":").map(Number);
  const t = new Date(2000, 0, 1, hh, mm).toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t}`;
}

// "J-12", "Demain !", "C'est aujourd'hui 🎉", or how long ago.
function countdown(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const today = new Date();
  const days = Math.round((new Date(y, m - 1, d) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (days === 0) return "C'est aujourd'hui 🎉";
  if (days === 1) return "Demain !";
  if (days > 1) return `J-${days}`;
  if (days === -1) return "C'était hier";
  return `C'était il y a ${-days} jours`;
}

// Colored initials bubble, same color for the same name everywhere.
function avatar(name, size = "") {
  const clean = String(name || "?").trim();
  const initials = clean
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `<span class="avatar ${size}" style="--hue:${hash % 360}" aria-hidden="true">${esc(initials || "?")}</span>`;
}

// Overlapping faces of the people coming, "+N" when there are many.
function faces(people, max = 5) {
  if (!people.length) return "";
  const shown = people.slice(0, max).map((g) => avatar(g.name, "sm")).join("");
  const more = people.length > max ? `<span class="avatar sm more">+${people.length - max}</span>` : "";
  return `<span class="faces">${shown}${more}</span>`;
}

// A little burst of confetti from an element (used when someone says "Je viens").
function confetti(from) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = from.getBoundingClientRect();
  const colors = ["#ffcd00", "#ff4d8d", "#3fcf8e", "#5b9dff", "#ff9f43", "#a78bfa"];
  for (let i = 0; i < 36; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = `${rect.left + rect.width / 2}px`;
    bit.style.top = `${rect.top + rect.height / 2}px`;
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty("--dx", `${(Math.random() - 0.5) * 320}px`);
    bit.style.setProperty("--dy", `${-120 - Math.random() * 220}px`);
    bit.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 1400);
  }
}

// Big header for an event: photo (or color gradient), countdown, title, date, theme.
function eventHero(eventId, ev, extra = "") {
  const photo = ev.background_version ? backgroundUrl(eventId, ev.background_version) : "";
  return `<header class="event-hero ${photo ? "has-photo" : ""}" ${photo ? `style="--hero-image:url('${esc(photo)}')"` : ""}>
      <div class="hero-inner">
        ${ev.date ? `<span class="chip">${esc(countdown(ev.date))}</span>` : ""}
        ${extra}
        <h1>${esc(ev.title)}</h1>
        <p class="hero-when">📅 ${esc(formatWhen(ev.date, ev.time))}</p>
        ${ev.theme ? `<p class="hero-theme">🎭 ${esc(ev.theme)}</p>` : ""}
      </div>
    </header>`;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Spotify links look like https://open.spotify.com/(intl-fr/)playlist/<id>?si=…
// Returns the embeddable player URL, or null for other links (short links, other services).
function spotifyEmbed(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "open.spotify.com") return null;
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

function musicLabel(url) {
  return /spotify\.(com|link)/.test(url) ? "Ouvrir dans Spotify" : "Ouvrir la playlist";
}

// D1 stores UTC as "YYYY-MM-DD HH:MM:SS".
function formatAgo(sqlDate) {
  const then = new Date(sqlDate.replace(" ", "T") + "Z");
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const sameDay = then.toDateString() === new Date().toDateString();
  return sameDay
    ? then.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" })
    : then.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
        " · " +
        then.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" });
}

function shareUrl(eventId) {
  return `${location.origin}/e/${eventId}`;
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

// Fields shared by the create and edit forms.
function extraFields(event = {}) {
  return `
      <label>Thème / dress code <span class="muted">(facultatif)</span>
        <input name="theme" maxlength="200" placeholder="Les arrêts de métro de Paris 🚇" value="${esc(event.theme)}">
      </label>
      <fieldset class="stack">
        <legend>🎵 Playlist <span class="muted">(facultatif)</span></legend>
        <label>Lien de la playlist Spotify
          <input name="playlist_url" type="url" maxlength="500" inputmode="url" placeholder="https://open.spotify.com/playlist/…" value="${esc(event.playlist_url)}">
        </label>
        <p class="muted small hint">Astuce : dans Spotify, ouvrez la playlist → ⋯ → <em>Inviter des collaborateurs</em> et collez ce lien, pour que les invités puissent ajouter des chansons.</p>
        <label>Message pour les invités
          <input name="playlist_note" maxlength="300" placeholder="Ajoutez vos chansons françaises préférées 🇫🇷" value="${esc(event.playlist_note)}">
        </label>
      </fieldset>`;
}

// ---------- colors ----------
// Must match COLORS in src/index.ts. "" is the default violet (follows light/dark mode).
// Each theme sets buttons/links (accent), the page background (bg) and the cards (card).
const COLORS = {
  "": { name: "Violet", accent: "#7c3aed", bg: "#faf7ff", card: "#ffffff" },
  metro: { name: "Métro la nuit", accent: "#ffcd00", bg: "#0f1d38", card: "#1a2b4f" },
  bleu: { name: "Bleu RATP", accent: "#0055c8", bg: "#e6efff", card: "#ffffff" },
  vert: { name: "Vert", accent: "#00814f", bg: "#e3f5ec", card: "#ffffff" },
  rose: { name: "Rose", accent: "#d6337a", bg: "#ffe6f1", card: "#ffffff" },
  rouge: { name: "Rouge", accent: "#d12b2b", bg: "#ffece8", card: "#ffffff" },
  orange: { name: "Orange", accent: "#e2690b", bg: "#fff0e0", card: "#ffffff" },
  nuit: { name: "Nuit", accent: "#a78bfa", bg: "#0f0a1e", card: "#1d1433" },
  disco: { name: "Disco", accent: "#ff4fd8", bg: "#1a0b2e", card: "#2a1450" },
  foret: { name: "Forêt", accent: "#e9c46a", bg: "#10241c", card: "#1b3a2d" },
};
const HEX = /^#[0-9a-f]{6}$/i;

// The saved value is a theme name, or custom colors as JSON {accent, bg, card}.
function parseColor(value) {
  if (!value) return null;
  if (COLORS[value]) return COLORS[value];
  try {
    const c = JSON.parse(value);
    if (["accent", "bg", "card"].every((k) => HEX.test(c[k]))) return c;
  } catch {}
  return null;
}

function isDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

const COLOR_PROPS = ["--accent", "--accent-text", "--accent-soft", "--bg", "--card", "--text", "--muted", "--border", "--fill", "--page-text", "color-scheme"];

// Applies the event's colors to the whole page; text colors are picked for contrast.
function applyColor(value) {
  const style = document.body.style;
  for (const prop of COLOR_PROPS) style.removeProperty(prop);
  const c = parseColor(value);
  if (!c) return;
  const text = isDark(c.card) ? "#f3efff" : "#1b1033";
  style.setProperty("--accent", c.accent);
  style.setProperty("--accent-text", isDark(c.accent) ? "#ffffff" : "#1b1033");
  style.setProperty("--accent-soft", `color-mix(in srgb, ${c.accent} 14%, ${c.card})`);
  style.setProperty("--bg", c.bg);
  style.setProperty("--card", c.card);
  style.setProperty("--text", text);
  style.setProperty("--muted", `color-mix(in srgb, ${text} 62%, ${c.card})`);
  style.setProperty("--border", `color-mix(in srgb, ${text} 14%, ${c.card})`);
  style.setProperty("--fill", `color-mix(in srgb, ${text} 5%, ${c.card})`);
  style.setProperty("--page-text", isDark(c.bg) ? "#f3efff" : "#1b1033");
  style.setProperty("color-scheme", isDark(c.card) ? "dark" : "light");
}

// Colors shown in the custom pickers: the saved ones, or the current theme's.
function currentColors(value) {
  return parseColor(value) || COLORS[""];
}

// ---------- background picture ----------

function backgroundUrl(eventId, version) {
  return `/api/parties/${eventId}/background?v=${version}`;
}

// Shows the event's picture behind the page, or the plain background when version is 0.
function setBackground(eventId, version) {
  const on = !!(eventId && version);
  document.body.classList.toggle("has-bg", on);
  if (on) document.body.style.setProperty("--bg-image", `url("${backgroundUrl(eventId, version)}")`);
  else document.body.style.removeProperty("--bg-image");
}

// Shrinks a photo to at most 1600px and re-encodes it as JPEG (well under 1 MB).
async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 950_000) return blob;
  }
  throw new Error("Cette image est trop lourde, essayez-en une autre.");
}

async function uploadBackground(eventId, token, blob) {
  let res;
  try {
    res = await fetch(`/api/parties/${eventId}/background`, {
      method: "PUT",
      headers: { "Content-Type": blob.type, Authorization: `Bearer ${token}` },
      body: blob,
    });
  } catch {
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur (${res.status})`);
  return data;
}

// Organizer-only floating buttons on the event page: pick a photo / remove it.
function setupBackgroundControl(eventId, token) {
  const picker = document.getElementById("color-picker");
  const open = document.getElementById("color-open");
  open.addEventListener("click", () => {
    picker.hidden = !picker.hidden;
    open.setAttribute("aria-expanded", String(!picker.hidden));
  });
  const save = (btn, color) =>
    withBusy(btn, async () => {
      renderSpace(eventId, await api(`/parties/${eventId}/color`, { method: "PUT", body: { color }, token }));
      toast("Couleurs mises à jour");
    });
  picker.addEventListener("click", (ev) => {
    const swatch = ev.target.closest("[data-color]");
    if (!swatch) return;
    applyColor(swatch.dataset.color); // instant preview
    save(swatch, swatch.dataset.color);
  });
  const inputs = [...picker.querySelectorAll("input[data-key]")];
  const custom = () => JSON.stringify(Object.fromEntries(inputs.map((i) => [i.dataset.key, i.value.toLowerCase()])));
  for (const input of inputs) input.addEventListener("input", () => applyColor(custom()));
  const saveCustom = document.getElementById("color-save");
  saveCustom.addEventListener("click", () => save(saveCustom, custom()));

  const fileInput = document.getElementById("bg-file");
  const change = document.getElementById("bg-change");
  change.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    withBusy(change, async () => {
      change.textContent = "Envoi…";
      try {
        renderSpace(eventId, await uploadBackground(eventId, token, await resizeImage(file)));
        toast("Image de fond mise à jour");
      } finally {
        change.textContent = "🖼️ Changer le fond";
      }
    });
  });
  document.getElementById("bg-remove")?.addEventListener("click", (ev) => {
    if (!confirm("Retirer l'image de fond ?")) return;
    withBusy(ev.currentTarget, async () => {
      renderSpace(eventId, await api(`/parties/${eventId}/background`, { method: "DELETE", token }));
      toast("Image de fond retirée");
    });
  });
}

// ---------- home: create event + your events ----------

function renderHome() {
  setBackground(null, 0);
  applyColor("");
  document.title = "Party Invite";
  const store = loadStore();
  const today = new Date().toISOString().slice(0, 10);
  const count = Object.keys(store.events).length;

  app.innerHTML = `
    ${count ? `<nav class="topbar"><span></span><a href="/mes-evenements">📅 Mes événements <span class="count">${count}</span></a></nav>` : ""}
    <header class="hero">
      <div class="emoji">🎉</div>
      <h1>Organisez une soirée</h1>
      <p class="muted">Créez un événement, partagez un lien. Les invités rejoignent avec leur prénom, sans appli ni compte.</p>
    </header>

    <form id="create" class="card stack" autocomplete="off">
      <label>C'est quoi l'occasion ?
        <input name="title" required maxlength="120" placeholder="L'anniversaire de Banu 🎂">
      </label>
      <div class="row">
        <label>Date <input name="date" type="date" required min="${today}"></label>
        <label>Heure <input name="time" type="time"></label>
      </div>
      <label>Adresse
        <input name="address" maxlength="300" placeholder="Rue, ville">
      </label>
      <label>Détails <span class="muted">(facultatif)</span>
        <textarea name="description" rows="3" maxlength="2000" placeholder="Apportez une bouteille, déguisements bienvenus…"></textarea>
      </label>
      ${extraFields()}
      <label>Votre prénom
        <input name="hostName" required maxlength="40" placeholder="Pour que les invités sachent qui reçoit" value="${esc(store.lastName)}">
      </label>
      <button class="primary" type="submit">Créer l'événement et obtenir le lien</button>
    </form>

  `;

  const form = document.getElementById("create");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    withBusy(form.querySelector("button"), async () => {
      const { eventId, guest } = await api("/parties", { method: "POST", body: data });
      setIdentity(eventId, {
        guestId: guest.id,
        token: guest.token,
        name: data.hostName.trim(),
        title: data.title.trim(),
        date: data.date,
        time: data.time,
        isHost: true,
        justCreated: true,
      });
      navigate(`/e/${eventId}`);
    });
  });
}

// ---------- my events ----------

function renderMine() {
  setBackground(null, 0);
  applyColor("");
  document.title = "Mes événements · Party Invite";
  const today = new Date().toISOString().slice(0, 10);

  const draw = (events, offline = false) => {
    const sorted = [...events].sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));
    const item = (e) => `<li><a class="event-link ${e.date && e.date < today ? "past" : ""}" href="/e/${esc(e.id)}">
        <strong>${esc(e.title || "Événement sans titre")}</strong>
        <span class="muted small">${esc(formatWhen(e.date, e.time))}${e.date && e.date >= today ? ` · ${esc(countdown(e.date))}` : ""}</span>
        ${e.going ? `<span class="muted small">🥳 ${e.going} ${e.going > 1 ? "viennent" : "vient"}</span>` : ""}
        ${!e.isHost && e.rsvp ? `<span class="small">${RSVP_EMOJI[e.rsvp]} ${RSVP_LABELS[e.rsvp]}</span>` : ""}
      </a></li>`;
    // Upcoming first (soonest on top), then past events (most recent on top).
    const ordered = (list) => [...list.filter((e) => !e.date || e.date >= today), ...list.filter((e) => e.date && e.date < today).reverse()];
    const section = (title, list, empty) => `<section class="stack">
        <h2>${title} <span class="count">${list.length}</span></h2>
        ${list.length ? `<ul class="events">${ordered(list).map(item).join("")}</ul>` : `<p class="muted small">${empty}</p>`}
      </section>`;
    app.innerHTML = `
      <nav class="topbar"><a href="/">← Créer un événement</a></nav>
      <header class="hero"><div class="emoji">📅</div><h1>Mes événements</h1>
        <p class="muted small">Les événements que vous avez ouverts dans ce navigateur.</p></header>
      ${offline ? `<p class="muted small center">Hors ligne : liste enregistrée sur cet appareil.</p>` : ""}
      ${section("👑 J'organise", sorted.filter((e) => e.isHost), `Aucun pour l'instant. <a href="/">Créez un événement</a> !`)}
      ${section("💌 Je suis invité·e", sorted.filter((e) => !e.isHost), "Quand quelqu'un vous envoie un lien et que vous le rejoignez, il apparaîtra ici.")}
    `;
  };

  const store = loadStore();
  const local = Object.entries(store.events).map(([id, e]) => ({ id, ...e }));
  draw(local);
  const tokens = local.map((e) => e.token).filter(Boolean);
  if (!tokens.length) return;
  api("/mine", { method: "POST", body: { tokens } })
    .then(({ events }) => {
      if (location.pathname !== "/mes-evenements") return;
      // Forget events that were deleted (or whose token no longer works), refresh the rest.
      const alive = new Set(events.map((e) => e.id));
      for (const e of local) if (e.token && !alive.has(e.id)) forgetIdentity(e.id);
      for (const e of events) setIdentity(e.id, { title: e.title, date: e.date, time: e.time, isHost: e.isHost });
      draw(events);
    })
    .catch(() => {
      if (location.pathname === "/mes-evenements") draw(local, true);
    });
}

// ---------- event page ----------

async function renderEvent(eventId) {
  const identity = getIdentity(eventId);
  let data;
  try {
    data = await api(`/parties/${eventId}`, { token: identity?.token });
  } catch (err) {
    return renderMessage(err.status === 404 ? "Cet événement n'existe pas (ou le lien est incomplet)." : err.message);
  }

  if (data.preview) {
    // Token missing or no longer valid: ask for a name.
    if (identity) forgetIdentity(eventId);
    return renderJoin(eventId, data.preview);
  }
  renderSpace(eventId, data);
}

function renderJoin(eventId, preview) {
  setBackground(eventId, preview.background_version);
  applyColor(preview.color);
  document.title = `${preview.title} · Party Invite`;
  const store = loadStore();
  app.innerHTML = `
    ${eventHero(
      eventId,
      preview,
      `<p class="hero-invite">💌 ${preview.hostName ? `${esc(preview.hostName)} vous ${preview.hostName.includes(" et ") ? "invitent" : "invite"} à` : "Vous êtes invité·e à"}</p>`,
    )}
    ${preview.going ? `<p class="center muted small going-line">🥳 ${preview.going} ${preview.going > 1 ? "personnes viennent" : "personne vient"} déjà</p>` : ""}
    <form id="join" class="card stack" autocomplete="off">
      <label>Comment vous appelez-vous ?
        <input name="name" required maxlength="40" placeholder="Votre prénom" value="${esc(store.lastName)}" autofocus>
      </label>
      <button class="primary" type="submit">Rejoindre la soirée</button>
      <p class="muted small center">Pas besoin de compte. Ce navigateur se souviendra de vous.</p>
    </form>
  `;
  const form = document.getElementById("join");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = new FormData(form).get("name").trim();
    withBusy(form.querySelector("button"), async () => {
      const { guest } = await api(`/parties/${eventId}/join`, { method: "POST", body: { name } });
      setIdentity(eventId, { guestId: guest.id, token: guest.token, name, title: preview.title, date: preview.date, time: preview.time, isHost: false });
      renderEvent(eventId);
    });
  });
}

const RSVP_LABELS = { going: "Je viens", maybe: "Peut-être", not_going: "Je ne peux pas" };
const RSVP_EMOJI = { going: "🥳", maybe: "🤔", not_going: "😢" };

function renderSpace(eventId, data) {
  const { event, me, guests } = data;
  setBackground(eventId, event.background_version);
  applyColor(event.color);
  const identity = getIdentity(eventId);
  // Keep the local copy fresh for "Your events".
  setIdentity(eventId, { name: me.name, title: event.title, date: event.date, time: event.time, isHost: me.isHost, justCreated: false });
  document.title = `${event.title} · Party Invite`;

  const groups = { going: [], maybe: [], not_going: [], none: [] };
  for (const g of guests) groups[g.rsvp || "none"].push(g);
  const guestList = (key, label) =>
    groups[key].length
      ? `<div class="guest-group"><h3>${label} <span class="count">${groups[key].length}</span></h3>
         <ul class="guests">${groups[key]
           .map(
             (g) => {
               const inner = `${avatar(g.name, "sm")}${esc(g.name)}${g.isHost ? ' <span class="badge">hôte</span>' : ""}${g.id === me.id ? ' <span class="badge you">vous</span>' : ""}`;
               return me.isHost && g.id !== me.id
                 ? `<li><button class="guest-chip" data-host-toggle="${esc(g.id)}" data-name="${esc(g.name)}" data-is-host="${g.isHost ? 1 : 0}">${inner}</button></li>`
                 : `<li>${inner}</li>`;
             },
           )
           .join("")}</ul></div>`
      : "";

  app.innerHTML = `
    <nav class="topbar"><a href="/mes-evenements">← Mes événements</a><span class="topbar-right"><span class="hello">${avatar(me.name, "sm")} Salut ${esc(me.name)} 👋</span><button class="bell" id="bell" aria-expanded="false" aria-label="Notifications">🔔<span class="bell-count" id="bell-count" hidden></span></button></span></nav>
    <div class="notif-panel card" id="notif-panel" hidden></div>

    ${eventHero(
      eventId,
      event,
      groups.going.length
        ? `<p class="hero-going">${faces(groups.going)} <span>${groups.going.length} ${groups.going.length > 1 ? "viennent" : "vient"}</span></p>`
        : "",
    )}

    ${
      me.isHost
        ? `<section class="card share ${identity?.justCreated ? "highlight" : ""}">
            <h2>${identity?.justCreated ? "Votre événement est en ligne ! 🎉" : "Invitez du monde"}</h2>
            <p class="muted small">Toute personne ayant ce lien peut rejoindre.</p>
            <div class="share-row">
              <input readonly value="${esc(shareUrl(eventId))}" id="share-url">
              <button id="copy">Copier</button>
            </div>
            <div class="share-buttons">
              <a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${event.title} 🎉 ${shareUrl(eventId)}`)}">WhatsApp</a>
              <button id="native-share" hidden>Partager…</button>
            </div>
          </section>`
        : ""
    }

    ${
      event.address || event.description || me.isHost
        ? `<section class="card event-info">
            ${event.address ? `<p class="address">📍 <a href="${mapsUrl(event.address)}" target="_blank" rel="noopener">${esc(event.address)}</a></p>` : ""}
            ${event.description ? `<p class="description">${esc(event.description)}</p>` : ""}
            ${me.isHost ? `<button class="link" id="edit">✏️ Modifier les détails</button>` : ""}
          </section>`
        : ""
    }

    <section class="card">
      <h2>Vous venez ?</h2>
      <div class="rsvp">
        ${Object.entries(RSVP_LABELS)
          .map(
            ([key, label]) =>
              `<button data-rsvp="${key}" class="${me.rsvp === key ? "selected" : ""}">${RSVP_EMOJI[key]} ${label}</button>`,
          )
          .join("")}
      </div>
    </section>

    <section class="card">
      <h2>Invités <span class="count">${guests.length}</span></h2>
      ${guestList("going", "Viennent")}
      ${guestList("maybe", "Peut-être")}
      ${guestList("not_going", "Ne viennent pas")}
      ${guestList("none", "Pas encore répondu")}
      ${me.isHost && guests.length > 1 ? `<p class="muted small">👑 Touchez un invité pour en faire un co-hôte : il pourra tout modifier comme vous.</p>` : ""}
    </section>

    ${musicSection(event, me, data.spotify)}

    <section class="card">
      <h2>💬 Commentaires</h2>
      <ul class="comments" id="comments"></ul>
      <form id="comment-form" class="comment-form" autocomplete="off">
        <ul class="mention-list" id="mention-list" role="listbox" hidden></ul>
        <textarea name="body" rows="2" maxlength="1000" placeholder="Écrivez un mot… (@ pour taguer quelqu'un)"></textarea>
        <div class="composer-bar">
          <button type="button" class="tool" id="emoji-open" aria-expanded="false" aria-label="Ajouter un emoji" title="Emojis">😊</button>
          ${data.gifs ? `<button type="button" class="tool gif-tool" id="gif-open" aria-expanded="false" aria-label="Ajouter un GIF" title="GIFs">GIF</button>` : ""}
          <button type="button" class="tool" id="mention-open" aria-label="Taguer quelqu'un" title="Taguer quelqu'un">@</button>
          <button class="primary" type="submit">Envoyer</button>
        </div>
        <div class="emoji-panel" id="emoji-panel" hidden>
          ${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}
        </div>
        ${
          data.gifs
            ? `<div class="gif-panel" id="gif-panel" hidden>
                <input type="search" id="gif-q" placeholder="Chercher un GIF (danse, champagne, Paris…)" enterkeyhint="search">
                <div class="gif-grid" id="gif-grid"></div>
                <p class="muted small gif-credit">Touchez un GIF pour l'envoyer · Powered by GIPHY</p>
              </div>`
            : ""
        }
      </form>
    </section>

    <p class="center small"><button class="link" id="rename">Changer mon prénom</button></p>

    ${
      me.isHost
        ? `<div class="color-picker" id="color-picker" hidden>
            <p class="small"><strong>Thèmes</strong></p>
            <div class="swatches">
              ${Object.entries(COLORS)
                .map(
                  ([key, c]) =>
                    `<button class="swatch ${key === (event.color || "") ? "selected" : ""}" data-color="${key}" style="--swatch:${c.accent};--swatch-bg:${c.bg}" aria-label="${esc(c.name)}" title="${esc(c.name)}"></button>`,
                )
                .join("")}
            </div>
            <p class="small"><strong>Personnaliser</strong></p>
            <div class="custom-colors">
              ${[
                ["accent", "Boutons et liens"],
                ["bg", "Fond de la page"],
                ["card", "Cartes"],
              ]
                .map(
                  ([key, label]) =>
                    `<label><input type="color" data-key="${key}" value="${currentColors(event.color)[key]}"> ${label}</label>`,
                )
                .join("")}
            </div>
            <button class="primary" id="color-save">Enregistrer mes couleurs</button>
          </div>
          <div class="bg-control">
            <button class="bg-fab" id="color-open" aria-expanded="false">🎨 Couleurs</button>
            ${event.background_version ? `<button class="bg-fab" id="bg-remove" aria-label="Retirer l'image de fond" title="Retirer l'image de fond">✕</button>` : ""}
            <button class="bg-fab" id="bg-change">🖼️ ${event.background_version ? "Changer le fond" : "Ajouter un fond"}</button>
            <input type="file" accept="image/*" id="bg-file" hidden>
          </div>`
        : ""
    }
  `;

  setupComments(eventId, me, data.comments || [], identity.token, data.guests || []);
  setupMusic(eventId, data, identity.token);
  if (me.isHost) setupBackgroundControl(eventId, identity.token);
  for (const btn of app.querySelectorAll("[data-host-toggle]")) {
    btn.addEventListener("click", () => {
      const makeHost = btn.dataset.isHost !== "1";
      const name = btn.dataset.name;
      if (!confirm(makeHost ? `Faire de ${name} un co-hôte ? Il pourra modifier l'événement, les couleurs et la playlist.` : `Retirer ${name} des hôtes ?`)) return;
      withBusy(btn, async () => {
        renderSpace(eventId, await api(`/parties/${eventId}/guests/${btn.dataset.hostToggle}/host`, { method: "PUT", body: { isHost: makeHost }, token: identity.token }));
        toast(makeHost ? `${name} est co-hôte 👑` : `${name} n'est plus hôte`);
      });
    });
  }

  for (const btn of app.querySelectorAll("[data-rsvp]")) {
    btn.addEventListener("click", () =>
      withBusy(btn, async () => {
        const next = await api(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: btn.dataset.rsvp }, token: identity.token });
        if (btn.dataset.rsvp === "going" && me.rsvp !== "going") confetti(btn);
        renderSpace(eventId, next);
      }),
    );
  }

  document.getElementById("rename").addEventListener("click", async () => {
    const name = prompt("Votre prénom", me.name)?.trim();
    if (!name || name === me.name) return;
    try {
      renderSpace(eventId, await api(`/parties/${eventId}/me`, { method: "PATCH", body: { name }, token: identity.token }));
    } catch (err) {
      toast(err.message);
    }
  });

  if (me.isHost) {
    document.getElementById("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareUrl(eventId));
      } catch {
        document.getElementById("share-url").select();
        document.execCommand("copy");
      }
      toast("Lien copié");
    });
    const native = document.getElementById("native-share");
    if (navigator.share) {
      native.hidden = false;
      native.addEventListener("click", () =>
        navigator.share({ title: event.title, text: `${event.title} 🎉`, url: shareUrl(eventId) }).catch(() => {}),
      );
    }
    document.getElementById("edit").addEventListener("click", () => renderEdit(eventId, data));
  }
}

function musicSection(event, me, spotify = {}) {
  const host = me.isHost;
  const hostControls = !host
    ? ""
    : spotify.connected
      ? `<p class="muted small">Connecté à Spotify (${esc(spotify.accountName)}) · <button class="link small" id="spotify-disconnect">Déconnecter</button></p>`
      : spotify.enabled
        ? `<div class="connect-box"><p class="small">Connectez votre compte Spotify pour que les invités ajoutent des chansons directement ici, même sans Spotify.</p>
             <button class="spotify-btn" id="spotify-connect">Connecter Spotify</button></div>`
        : `<p class="muted small">🔌 Ajout de chansons depuis l'appli : les clés Spotify ne sont pas encore configurées sur le serveur (visible par l'hôte seulement).</p>`;

  if (!event.playlist_url && !spotify.connected) {
    if (!host) return "";
    return `<section class="card stack"><h2>🎵 Playlist</h2>
        ${
          spotify.enabled
            ? hostControls + `<p class="muted small center">ou <button class="link small" id="add-playlist">collez le lien d'une playlist</button></p>`
            : `<p class="muted small">Ajoutez une playlist Spotify pour que les invités puissent l'écouter et y ajouter leurs chansons.</p>
               <button id="add-playlist">Ajouter une playlist</button>${hostControls}`
        }</section>`;
  }

  const embed = spotifyEmbed(event.playlist_url);
  const songs = spotify.songs || [];
  return `<section class="card music">
      <h2>🎵 Playlist</h2>
      ${event.playlist_note ? `<p class="playlist-note">${esc(event.playlist_note)}</p>` : ""}
      ${
        spotify.connected
          ? `<form id="song-search" class="song-search" role="search" autocomplete="off">
               <input name="q" type="search" maxlength="100" placeholder="🔎 Ajouter une chanson : titre ou artiste" enterkeyhint="search">
             </form>
             <ul class="tracks" id="song-results"></ul>`
          : ""
      }
      ${
        embed
          ? `<iframe class="spotify" id="spotify-embed" src="${esc(embed)}" height="352" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Playlist Spotify"></iframe>`
          : ""
      }
      ${event.playlist_url ? `<a class="btn spotify-btn" href="${esc(event.playlist_url)}" target="_blank" rel="noopener">${musicLabel(event.playlist_url)}</a>` : ""}
      ${
        songs.length
          ? `<h3>Ajoutées par les invités <span class="count">${songs.length}</span></h3>
             <ul class="tracks">${songs.map((t) => trackItem(t, `par ${esc(t.addedBy)}`)).join("")}</ul>`
          : ""
      }
      ${hostControls}
    </section>`;
}

function trackItem(t, right) {
  return `<li>
      ${t.image ? `<img src="${esc(t.image)}" alt="" width="40" height="40" loading="lazy">` : `<span class="cover">🎵</span>`}
      <span class="track-text"><strong>${esc(t.title)}</strong><span class="muted small">${esc(t.artists)}</span></span>
      <span class="track-side">${right}</span>
    </li>`;
}

const SPOTIFY_RESULTS = {
  connected: "Spotify est connecté 🎉 Les invités peuvent ajouter des chansons.",
  cancelled: "Connexion Spotify annulée.",
  not_owner: "Ce compte Spotify ne peut pas modifier la playlist de l'événement. Connectez le compte propriétaire, ou retirez le lien pour en créer une nouvelle.",
  not_allowed: "Ce compte Spotify n'est pas autorisé par l'appli Spotify (User Management).",
  error: "La connexion à Spotify a échoué, réessayez.",
  expired: "La connexion à Spotify a expiré, réessayez.",
};

// Shows the outcome of the Spotify OAuth redirect (?spotify=…) once, then cleans the URL.
function spotifyRedirectNotice() {
  const params = new URLSearchParams(location.search);
  const result = params.get("spotify");
  if (!result) return;
  history.replaceState(null, "", location.pathname);
  setTimeout(() => toast(SPOTIFY_RESULTS[result] || SPOTIFY_RESULTS.error, 6000), 300);
}

function setupMusic(eventId, data, token) {
  const { spotify = {} } = data;
  document.getElementById("add-playlist")?.addEventListener("click", () => renderEdit(eventId, data));

  document.getElementById("spotify-connect")?.addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, async () => {
      const { url } = await api(`/parties/${eventId}/spotify/connect`, { method: "POST", token });
      location.href = url;
    }),
  );
  document.getElementById("spotify-disconnect")?.addEventListener("click", async () => {
    if (!confirm("Déconnecter Spotify ? Les invités ne pourront plus ajouter de chansons depuis l'appli.")) return;
    try {
      renderSpace(eventId, await api(`/parties/${eventId}/spotify`, { method: "DELETE", token }));
    } catch (err) {
      toast(err.message);
    }
  });

  const form = document.getElementById("song-search");
  if (!form) return;
  const input = form.querySelector("input");
  const results = document.getElementById("song-results");
  const added = new Set((spotify.songs || []).map((t) => t.trackId));
  let timer;
  let seq = 0;

  const search = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) {
      results.innerHTML = "";
      return;
    }
    try {
      const { tracks } = await api(`/parties/${eventId}/spotify/search?q=${encodeURIComponent(q)}`, { token });
      if (mine !== seq) return; // a newer search is on its way
      results.innerHTML = tracks.length
        ? tracks
            .map((t) =>
              trackItem(
                t,
                added.has(t.trackId)
                  ? `<span class="muted small">Déjà ajoutée</span>`
                  : `<button class="add-song" data-track="${esc(t.trackId)}">Ajouter</button>`,
              ),
            )
            .join("")
        : `<li class="empty muted small">Aucun résultat</li>`;
    } catch (err) {
      if (mine === seq) toast(err.message);
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 350);
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    clearTimeout(timer);
    search();
  });

  results.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-track]");
    if (!btn) return;
    withBusy(btn, async () => {
      await api(`/parties/${eventId}/spotify/songs`, { method: "POST", body: { trackId: btn.dataset.track }, token });
      toast("Ajoutée à la playlist 🎶");
      // Re-fetch so the song list (and the embedded player) show the new song.
      renderSpace(eventId, await api(`/parties/${eventId}`, { token }));
    });
  });
}

// ---------- comment wall ----------
// Not realtime: we refresh every few seconds while the event page is open.

let commentsTimer = null;

function stopCommentsPolling() {
  clearInterval(commentsTimer);
  commentsTimer = null;
}

const EMOJIS = [
  "😂", "🥰", "😍", "😘", "😎", "🤩", "🥳", "😭", "🤣", "😅", "🙏", "👏",
  "🙌", "💃", "🕺", "👀", "🔥", "✨", "🎉", "🎊", "🍾", "🥂", "🍷", "🍸",
  "🍕", "🥐", "🧀", "🎶", "🎵", "🚇", "🗼", "🇫🇷", "❤️", "💜", "💖", "👍",
  "😴", "🤔", "🙈", "😱", "💯", "🫶",
];

const GIF_LINE = /^\[gif:([A-Za-z0-9]+)\]$/;
const gifUrl = (id) => `https://media.giphy.com/media/${id}/200w.webp`;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Escapes a comment's text and highlights "@Name" for names we know (longest first, so
// "@Marie Claire" wins over "@Marie").
function formatCommentText(text, names, myName) {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return esc(text);
  const re = new RegExp(`@(${sorted.map(escRe).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    const isMe = m[1].toLowerCase() === myName.toLowerCase();
    out += `<span class="mention${isMe ? " me" : ""}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// Splits a stored comment into its text and the GIFs it carries ("[gif:ID]" lines).
function parseComment(body) {
  const gifs = [];
  const lines = [];
  for (const line of body.split("\n")) {
    const m = line.trim().match(GIF_LINE);
    if (m) gifs.push(m[1]);
    else lines.push(line);
  }
  return { text: lines.join("\n").trim(), gifs };
}

function mentionsMe(text, myName) {
  const re = new RegExp(`@${escRe(myName)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

function setupComments(eventId, me, initial, token, guests) {
  stopCommentsPolling();
  const list = document.getElementById("comments");
  const form = document.getElementById("comment-form");
  const textarea = form.querySelector("textarea");
  const sendBtn = form.querySelector("button[type=submit]");
  let lastKey = "";
  // Everyone we can tag: guests, plus authors of comments (in case someone joined since).
  const people = new Map(guests.map((g) => [g.id, g.name]));

  // ----- in-app notifications: who liked my comments or tagged me -----
  // Built from the comments we already poll. "Seen" is the newest server timestamp the
  // guest has looked at, kept in this browser with their identity.
  const bell = document.getElementById("bell");
  const bellCount = document.getElementById("bell-count");
  const panel = document.getElementById("notif-panel");
  const baseTitle = document.title;
  let notifs = [];
  let initialNotifs = true;
  let lastNewest = "";

  const snippet = (body) => {
    const { text, gifs } = parseComment(body);
    const t = text.length > 60 ? text.slice(0, 57) + "…" : text;
    return t || (gifs.length ? "GIF" : "");
  };

  function updateNotifications(comments) {
    const list = [];
    for (const c of comments) {
      if (c.guestId === me.id) {
        for (const l of c.likes || []) {
          if (l.guestId !== me.id) list.push({ kind: "like", from: l.name, at: l.at, id: c.id, text: snippet(c.body) });
        }
      } else if (mentionsMe(parseComment(c.body).text, me.name)) {
        list.push({ kind: "mention", from: c.name, at: c.createdAt, id: c.id, text: snippet(c.body) });
      }
    }
    notifs = list.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
    const seen = getIdentity(eventId)?.notifSeen || "";
    const unread = notifs.filter((n) => n.at > seen);
    bellCount.hidden = !unread.length;
    bellCount.textContent = unread.length > 9 ? "9+" : String(unread.length);
    document.title = unread.length ? `(${unread.length}) ${baseTitle}` : baseTitle;
    // Something new arrived while the page was open: say so.
    const newest = notifs[0]?.at || "";
    if (!initialNotifs && newest > lastNewest && unread.length && unread[0].at > lastNewest) toast(notifText(unread[0]), 4000);
    lastNewest = newest > lastNewest ? newest : lastNewest;
    if (!panel.hidden) drawPanel(seen);
  }

  const notifText = (n) => (n.kind === "like" ? `❤️ ${n.from} a aimé votre commentaire` : `💬 ${n.from} vous a tagué·e`);

  function drawPanel(seen) {
    panel.innerHTML = `<h2>Notifications</h2>${
      notifs.length
        ? `<ul class="notifs">${notifs
            .map(
              (n) => `<li class="${n.at > seen ? "unread" : ""}"><button data-goto="${esc(n.id)}">
                ${avatar(n.from, "sm")}
                <span class="notif-text"><span><strong>${esc(n.from)}</strong> ${n.kind === "like" ? "a aimé votre commentaire" : "vous a tagué·e"}${n.text ? ` : « ${esc(n.text)} »` : ""}</span>
                <span class="muted small">${esc(formatAgo(n.at))}</span></span>
              </button></li>`,
            )
            .join("")}</ul>`
        : `<p class="muted small">Rien pour l'instant. Quand quelqu'un aime votre commentaire ou vous tague avec @${esc(me.name)}, ça s'affichera ici.</p>`
    }`;
  }

  const setPanel = (open) => {
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", String(open));
    if (!open) return;
    drawPanel(getIdentity(eventId)?.notifSeen || "");
    // Opening the bell marks everything as read.
    if (notifs[0]) setIdentity(eventId, { notifSeen: notifs[0].at });
    bellCount.hidden = true;
    document.title = baseTitle;
  };
  bell.addEventListener("click", () => setPanel(panel.hidden));
  panel.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-goto]");
    if (!btn) return;
    setPanel(false);
    const li = document.getElementById(`c-${btn.dataset.goto}`);
    if (!li) return;
    li.scrollIntoView({ block: "center", behavior: "smooth" });
    li.classList.remove("flash");
    void li.offsetWidth;
    li.classList.add("flash");
  });

  const draw = (comments) => {
    for (const c of comments) people.set(c.guestId, c.name);
    updateNotifications(comments);
    const key = comments.map((c) => c.id + c.name + (c.likes || []).map((l) => l.guestId).join("+")).join();
    if (key === lastKey) {
      // Same comments: just refresh the "x min ago" labels.
      for (const el of list.querySelectorAll("[data-at]")) el.textContent = formatAgo(el.dataset.at);
      return;
    }
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    lastKey = key;
    const names = [...people.values()];
    list.innerHTML = comments.length
      ? comments
          .map((c) => {
            const { text, gifs } = parseComment(c.body);
            const mine = c.guestId === me.id;
            const tagged = !mine && mentionsMe(text, me.name);
            const likes = c.likes || [];
            const liked = likes.some((l) => l.guestId === me.id);
            const likers = likes.map((l) => (l.guestId === me.id ? "Vous" : l.name)).join(", ");
            return `<li id="c-${esc(c.id)}" class="${mine ? "mine" : ""} ${tagged ? "tagged" : ""}">
              ${avatar(c.name)}
              <div class="comment-body">
                <div class="comment-meta"><strong>${esc(c.name)}</strong>
                  <span class="muted small" data-at="${esc(c.createdAt)}">${esc(formatAgo(c.createdAt))}</span>
                  <span class="comment-actions">
                    ${mine ? "" : `<button class="link small" data-reply="${esc(c.name)}">Répondre</button>`}
                    ${mine || me.isHost ? `<button class="link small delete" data-delete="${esc(c.id)}" aria-label="Supprimer le commentaire">Supprimer</button>` : ""}
                  </span>
                </div>
                ${text ? `<p>${formatCommentText(text, names, me.name)}</p>` : ""}
                ${gifs.map((id) => `<img class="comment-gif" src="${gifUrl(id)}" alt="GIF" loading="lazy">`).join("")}
                <div class="comment-foot">
                  <button class="like ${liked ? "on" : ""}" data-like="${esc(c.id)}" aria-pressed="${liked}" aria-label="${liked ? "Je n'aime plus" : "J'aime"}">${liked ? "❤️" : "🤍"}${likes.length ? ` <span>${likes.length}</span>` : ""}</button>
                  ${likes.length ? `<span class="muted small likers">${esc(likers)}</span>` : ""}
                </div>
              </div></li>`;
          })
          .join("")
      : `<li class="empty muted small">Pas encore de commentaires. Lancez-vous !</li>`;
    if (nearBottom || !list.dataset.ready) list.scrollTop = list.scrollHeight;
    list.dataset.ready = "1";
  };
  draw(initial);
  initialNotifs = false;

  // GIFs load after the list is drawn: keep the newest comment in view if we were at the bottom.
  let stickToBottom = true;
  list.addEventListener("scroll", () => {
    stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  });
  list.addEventListener(
    "load",
    () => {
      if (stickToBottom) list.scrollTop = list.scrollHeight;
    },
    true,
  );

  const refresh = async () => {
    if (document.hidden || !document.body.contains(list)) return;
    try {
      draw((await api(`/parties/${eventId}/comments`, { token })).comments);
    } catch {
      // Offline for a moment: try again on the next tick.
    }
  };
  commentsTimer = setInterval(refresh, 8000);

  // ----- inserting into the text box -----
  const insert = (str, { replaceBefore = 0 } = {}) => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start - replaceBefore) + str + textarea.value.slice(end);
    const caret = start - replaceBefore + str.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    updateMentions();
  };

  const reply = (name) => {
    const tag = `@${name} `;
    if (!textarea.value.includes(tag.trim())) {
      textarea.value = tag + textarea.value.replace(/^\s+/, "");
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  list.addEventListener("click", async (ev) => {
    const replyBtn = ev.target.closest("[data-reply]");
    if (replyBtn) return reply(replyBtn.dataset.reply);
    const likeBtn = ev.target.closest("[data-like]");
    if (likeBtn) {
      const liked = likeBtn.getAttribute("aria-pressed") !== "true";
      return withBusy(likeBtn, async () => {
        draw((await api(`/parties/${eventId}/comments/${likeBtn.dataset.like}/like`, { method: "PUT", body: { liked }, token })).comments);
      });
    }
    const btn = ev.target.closest("[data-delete]");
    if (!btn || !confirm("Supprimer ce commentaire ?")) return;
    withBusy(btn, async () => {
      draw((await api(`/parties/${eventId}/comments/${btn.dataset.delete}`, { method: "DELETE", token })).comments);
    });
  });

  // ----- @mention suggestions -----
  const mentionList = document.getElementById("mention-list");
  let mentionQuery = null; // text typed after "@", or null when not tagging
  let mentionIndex = 0;

  const mentionMatches = () => {
    const q = mentionQuery.toLowerCase();
    return [...new Set(people.values())]
      .filter((n) => n !== me.name && n.toLowerCase().includes(q))
      .sort((a, b) => b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q) || a.localeCompare(b))
      .slice(0, 6);
  };

  function updateMentions() {
    const before = textarea.value.slice(0, textarea.selectionStart ?? 0);
    const m = before.match(/(?:^|\s)@([^\s@]{0,20})$/u);
    mentionQuery = m ? m[1] : null;
    const matches = mentionQuery === null ? [] : mentionMatches();
    if (!matches.length) {
      mentionList.hidden = true;
      return;
    }
    mentionIndex = Math.min(mentionIndex, matches.length - 1);
    mentionList.innerHTML = matches
      .map(
        (n, i) =>
          `<li role="option" aria-selected="${i === mentionIndex}"><button type="button" data-mention="${esc(n)}">${avatar(n, "sm")} ${esc(n)}</button></li>`,
      )
      .join("");
    mentionList.hidden = false;
  }

  const pickMention = (name) => {
    insert(`@${name} `, { replaceBefore: mentionQuery.length + 1 });
    mentionList.hidden = true;
  };

  mentionList.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep focus in the text box
  mentionList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mention]");
    if (btn) pickMention(btn.dataset.mention);
  });
  textarea.addEventListener("input", () => {
    mentionIndex = 0;
    updateMentions();
  });
  textarea.addEventListener("click", updateMentions);
  textarea.addEventListener("blur", () => setTimeout(() => (mentionList.hidden = true), 150));
  document.getElementById("mention-open").addEventListener("click", () => {
    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    insert(before && !/\s$/.test(before) ? " @" : "@");
  });

  textarea.addEventListener("keydown", (ev) => {
    if (!mentionList.hidden) {
      const matches = mentionMatches();
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        mentionIndex = (mentionIndex + (ev.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        updateMentions();
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") {
        ev.preventDefault();
        pickMention(matches[mentionIndex]);
        return;
      }
      if (ev.key === "Escape") {
        mentionList.hidden = true;
        return;
      }
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && matchMedia("(pointer: fine)").matches) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  // ----- emoji and GIF panels -----
  const emojiBtn = document.getElementById("emoji-open");
  const emojiPanel = document.getElementById("emoji-panel");
  const gifBtn = document.getElementById("gif-open");
  const gifPanel = document.getElementById("gif-panel");

  const toggle = (btn, panel, open = panel.hidden) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  emojiPanel.addEventListener("mousedown", (ev) => ev.preventDefault());
  emojiBtn.addEventListener("click", () => {
    if (gifPanel) toggle(gifBtn, gifPanel, false);
    toggle(emojiBtn, emojiPanel);
  });
  emojiPanel.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-emoji]");
    if (btn) insert(btn.dataset.emoji);
  });

  const send = async (body) => {
    const { comments } = await api(`/parties/${eventId}/comments`, { method: "POST", body: { body }, token });
    textarea.value = "";
    toggle(emojiBtn, emojiPanel, false);
    if (gifPanel) toggle(gifBtn, gifPanel, false);
    lastKey = "";
    list.dataset.ready = "";
    draw(comments);
  };

  if (gifPanel) {
    const grid = document.getElementById("gif-grid");
    const q = document.getElementById("gif-q");
    let searchTimer = null;
    let searchSeq = 0;
    const search = async () => {
      const seq = ++searchSeq;
      grid.innerHTML = `<p class="muted small">Recherche…</p>`;
      try {
        const { gifs } = await api(`/parties/${eventId}/gifs?q=${encodeURIComponent(q.value.trim())}`, { token });
        if (seq !== searchSeq) return;
        grid.innerHTML = gifs.length
          ? gifs
              .map(
                (g) =>
                  `<button type="button" data-gif="${esc(g.id)}" title="${esc(g.title)}"><img src="${esc(g.preview)}" alt="${esc(g.title || "GIF")}" loading="lazy" width="${g.width}" height="${g.height}"></button>`,
              )
              .join("")
          : `<p class="muted small">Aucun GIF trouvé.</p>`;
      } catch (err) {
        if (seq === searchSeq) grid.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
      }
    };
    gifBtn.addEventListener("click", () => {
      toggle(emojiBtn, emojiPanel, false);
      toggle(gifBtn, gifPanel);
      if (!gifPanel.hidden) {
        if (!grid.children.length) search();
        if (matchMedia("(pointer: fine)").matches) q.focus();
      }
    });
    q.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(search, 500);
    });
    q.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        clearTimeout(searchTimer);
        search();
      }
    });
    grid.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-gif]");
      if (!btn) return;
      // The GIF goes out with whatever is typed, e.g. "@Banu trop bien" + GIF.
      const text = textarea.value.trim();
      withBusy(btn, () => send((text ? text + "\n" : "") + `[gif:${btn.dataset.gif}]`));
    });
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const body = textarea.value.trim();
    if (!body) return;
    withBusy(sendBtn, () => send(body));
  });
}

function renderEdit(eventId, data) {
  const { event } = data;
  const identity = getIdentity(eventId);
  app.innerHTML = `
    <nav class="topbar"><a href="/e/${esc(eventId)}" id="back">← Retour</a></nav>
    <form id="edit-form" class="card stack" autocomplete="off">
      <h2>Modifier l'événement</h2>
      <label>Titre <input name="title" required maxlength="120" value="${esc(event.title)}"></label>
      <div class="row">
        <label>Date <input name="date" type="date" required value="${esc(event.date)}"></label>
        <label>Heure <input name="time" type="time" value="${esc(event.time)}"></label>
      </div>
      <label>Adresse <input name="address" maxlength="300" value="${esc(event.address)}"></label>
      <label>Détails <textarea name="description" rows="4" maxlength="2000">${esc(event.description)}</textarea></label>
      ${extraFields(event)}
      <button class="primary" type="submit">Enregistrer</button>
    </form>
    <section class="card danger-zone stack">
      <h2>Supprimer l'événement</h2>
      <p class="muted small">L'événement disparaît pour tout le monde : invités, réponses, commentaires et fond. La playlist Spotify, elle, reste sur Spotify. C'est définitif.</p>
      <button class="danger" id="delete-event">🗑️ Supprimer « ${esc(event.title)} »</button>
    </section>
  `;
  document.getElementById("delete-event").addEventListener("click", (ev) => {
    const others = data.guests.length - 1;
    const warning = `Supprimer « ${event.title} » pour tout le monde ?${others > 0 ? `\n\n${others} ${others > 1 ? "invités perdront" : "invité perdra"} l'accès.` : ""}\n\nCette action est définitive.`;
    if (!confirm(warning)) return;
    withBusy(ev.currentTarget, async () => {
      await api(`/parties/${eventId}`, { method: "DELETE", token: identity.token });
      forgetIdentity(eventId);
      navigate("/mes-evenements");
      toast("Événement supprimé");
    });
  });
  document.getElementById("back").addEventListener("click", (ev) => {
    ev.preventDefault();
    renderSpace(eventId, data);
  });
  const form = document.getElementById("edit-form");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    withBusy(form.querySelector("button"), async () => {
      renderSpace(eventId, await api(`/parties/${eventId}`, { method: "PATCH", body, token: identity.token }));
      toast("Enregistré");
    });
  });
}

function renderMessage(text) {
  setBackground(null, 0);
  applyColor("");
  app.innerHTML = `<section class="card center stack"><div class="emoji">🤷</div><p>${esc(text)}</p><a class="btn primary" href="/">Créer un événement</a></section>`;
}

// ---------- router ----------

function route() {
  stopCommentsPolling();
  const match = location.pathname.match(/^\/e\/([A-Za-z0-9_-]+)\/?$/);
  window.scrollTo(0, 0);
  if (match) {
    spotifyRedirectNotice();
    renderEvent(match[1]);
  } else if (/^\/mes-evenements\/?$/.test(location.pathname)) renderMine();
  else renderHome();
}

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[href^='/']");
  if (!a || a.target || ev.metaKey || ev.ctrlKey) return;
  ev.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", route);
route();
