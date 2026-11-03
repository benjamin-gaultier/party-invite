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
  return `<header data-card="hero" class="event-hero ${photo ? "has-photo" : ""}" ${photo ? `style="--hero-image:url('${esc(photo)}')"` : ""}>
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

// ---------- card fonts and text colors ----------
// Must match FONTS and CARDS in src/index.ts. `g` is the Google Fonts family spec, loaded only when used.
const FONTS = {
  bricolage: { name: "Bricolage (moderne)", css: '"Bricolage Grotesque", system-ui, sans-serif', g: "Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800" },
  system: { name: "Classique", css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  playfair: { name: "Playfair (élégant)", css: '"Playfair Display", Georgia, serif', g: "Playfair+Display:wght@400;700" },
  abril: { name: "Abril (magazine)", css: '"Abril Fatface", Georgia, serif', g: "Abril+Fatface" },
  limelight: { name: "Limelight (art déco)", css: '"Limelight", Georgia, serif', g: "Limelight" },
  bebas: { name: "Bebas (affiche)", css: '"Bebas Neue", Impact, sans-serif', g: "Bebas+Neue" },
  poppins: { name: "Poppins (rond)", css: '"Poppins", system-ui, sans-serif', g: "Poppins:wght@400;600;800" },
  spacemono: { name: "Space Mono (machine à écrire)", css: '"Space Mono", ui-monospace, monospace', g: "Space+Mono:wght@400;700" },
  pacifico: { name: "Pacifico (rétro)", css: '"Pacifico", cursive', g: "Pacifico" },
  lobster: { name: "Lobster (bistrot)", css: '"Lobster", cursive', g: "Lobster" },
  dancing: { name: "Dancing Script (manuscrit)", css: '"Dancing Script", cursive', g: "Dancing+Script:wght@400;700" },
  caveat: { name: "Caveat (feutre)", css: '"Caveat", cursive', g: "Caveat:wght@400;700" },
};
// The event page cards a host can style, with the name shown in the picker.
const CARDS = [
  ["hero", "En-tête (titre, date)"],
  ["info", "Adresse et description"],
  ["rsvp", "Vous venez ?"],
  ["guests", "Invités"],
  ["music", "Playlist"],
  ["photos", "Photos"],
  ["comments", "Commentaires"],
];
const CARD_PROPS = { titleFont: "font", title: "color", textFont: "font", text: "color" };

// Keeps only known cards and valid values: {info: {titleFont, title, textFont, text}, …}.
function cleanCards(cards) {
  const out = {};
  if (!cards || typeof cards !== "object") return out;
  for (const [key] of CARDS) {
    const style = cards[key];
    if (!style || typeof style !== "object") continue;
    const clean = {};
    for (const [prop, kind] of Object.entries(CARD_PROPS)) {
      const v = style[prop];
      if (kind === "font" ? Object.hasOwn(FONTS, v) : HEX.test(v || "")) clean[prop] = kind === "font" ? v : v.toLowerCase();
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

// The saved value is a theme name, or JSON: {theme} or custom colors {accent, bg, card}, plus optional cards.
// Returns {theme, custom, cards}: custom is null when a theme is used.
function parseStyle(value) {
  const out = { theme: "", custom: null, cards: {} };
  if (!value) return out;
  if (Object.hasOwn(COLORS, value)) return { ...out, theme: value };
  try {
    const v = JSON.parse(value);
    if (Object.hasOwn(COLORS, v.theme)) out.theme = v.theme;
    else if (["accent", "bg", "card"].every((k) => HEX.test(v[k]))) out.custom = { accent: v.accent, bg: v.bg, card: v.card };
    out.cards = cleanCards(v.cards);
  } catch {}
  return out;
}

// Back to the stored form: a plain theme name when there is nothing else, like before cards existed.
function serializeStyle(style) {
  const cards = cleanCards(style.cards);
  const extra = Object.keys(cards).length ? { cards } : {};
  if (style.custom) return JSON.stringify({ ...style.custom, ...extra });
  return extra.cards ? JSON.stringify({ theme: style.theme, ...extra }) : style.theme;
}

// The page colors {accent, bg, card} for a saved value, or null for the default (follows light/dark mode).
function parseColor(value) {
  const style = parseStyle(value);
  return style.custom || (style.theme ? COLORS[style.theme] : null);
}

const loadedFonts = new Set();
function loadFonts(keys) {
  const todo = [...new Set(keys)].filter((k) => FONTS[k]?.g && !loadedFonts.has(k));
  if (!todo.length) return;
  for (const k of todo) loadedFonts.add(k);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${todo.map((k) => `family=${FONTS[k].g}`).join("&")}&display=swap`;
  document.head.append(link);
}

// Per-card fonts and text colors, as a <style> tag. Values are whitelisted by cleanCards.
function applyCardStyles(cards) {
  let tag = document.getElementById("card-styles");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "card-styles";
    document.head.append(tag);
  }
  loadFonts(Object.values(cards).flatMap((c) => [c.titleFont, c.textFont]));
  tag.textContent = Object.entries(cards)
    .map(([key, c]) => {
      const sel = `[data-card="${key}"]`;
      const text = [
        c.textFont && `font-family: ${FONTS[c.textFont].css}`,
        c.text && `color: ${c.text}; --text: ${c.text}; --muted: color-mix(in srgb, ${c.text} 68%, transparent)`,
      ].filter(Boolean);
      const title = [c.titleFont && `font-family: ${FONTS[c.titleFont].css}`, c.title && `color: ${c.title}`].filter(Boolean);
      return (text.length ? `${sel} { ${text.join("; ")}; }\n` : "") + (title.length ? `${sel} :is(h1, h2) { ${title.join("; ")}; }\n` : "");
    })
    .join("");
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
  applyCardStyles(parseStyle(value).cards);
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

// ---------- per-card style (host) ----------
// Each card gets a small "Aa" button that opens a sheet with just that card's fonts and colors.

let closeCardStyle = () => {};
let openCardStyle = () => {};
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-card-edit]");
  if (btn) openCardStyle(btn.dataset.cardEdit);
});

// Adds the "Aa" buttons (hosts only). Called again after live blocks are swapped.
function addCardButtons() {
  if (!space.data?.me?.isHost) return;
  for (const el of app.querySelectorAll("[data-card]")) {
    if (el.querySelector(":scope > .card-edit")) continue;
    const name = CARDS.find(([k]) => k === el.dataset.card)?.[1] || "";
    el.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="card-edit" data-card-edit="${el.dataset.card}" aria-label="Police et couleurs : ${esc(name)}" title="Police et couleurs">Aa</button>`,
    );
  }
}

function setupCardStyle(eventId, token) {
  const panel = document.getElementById("card-style");
  const controls = [...panel.querySelectorAll("[data-prop]")];
  let key = null;
  let cards = {};
  const saved = () => space.data.event.color;
  const withCards = () => serializeStyle({ ...parseStyle(saved()), cards });
  const cardEl = () => app.querySelector(`[data-card="${key}"]`);

  // Puts the card's values in the controls. Unset colors show what the card uses now.
  function fill() {
    const el = cardEl();
    const shown = (sel) => {
      const target = (sel && el?.querySelector(sel)) || el || document.body;
      const [r, g, b] = getComputedStyle(target).color.match(/\d+/g).map(Number);
      return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    };
    const current = cards[key] || {};
    for (const control of controls) {
      const prop = control.dataset.prop;
      if (CARD_PROPS[prop] === "font") control.value = current[prop] || "";
      else control.value = current[prop] || shown(prop === "title" ? "h1, h2" : "");
      panel.querySelector(`[data-auto="${prop}"]`)?.toggleAttribute("hidden", !current[prop]);
    }
  }
  const setProp = (prop, value) => {
    const next = { ...cards[key], [prop]: value };
    if (!value) delete next[prop];
    cards = { ...cards, [key]: next };
    applyColor(withCards());
    fill();
  };

  closeCardStyle = () => {
    panel.hidden = true;
    cardEl()?.classList.remove("card-editing");
    key = null;
    applyColor(saved()); // drop the unsaved preview
  };
  openCardStyle = (k) => {
    const picker = document.getElementById("color-picker");
    if (picker && !picker.hidden) document.getElementById("color-open").click(); // one menu at a time
    if (key) closeCardStyle();
    key = k;
    cards = parseStyle(saved()).cards;
    loadFonts(Object.keys(FONTS)); // so each choice shows right away
    panel.querySelector("#card-style-title").textContent = `Aa · ${CARDS.find(([c]) => c === k)?.[1] || ""}`;
    panel.hidden = false;
    const el = cardEl();
    el?.classList.add("card-editing");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
    fill();
  };

  for (const control of controls) {
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => setProp(control.dataset.prop, control.value.toLowerCase()));
  }
  for (const btn of panel.querySelectorAll("[data-auto]")) btn.addEventListener("click", () => setProp(btn.dataset.auto, ""));
  panel.querySelector("#card-reset").addEventListener("click", () => {
    const { [key]: _, ...rest } = cards;
    cards = rest;
    applyColor(withCards());
    fill();
  });
  panel.querySelector("#card-style-close").addEventListener("click", closeCardStyle);
  const saveBtn = panel.querySelector("#card-style-save");
  saveBtn.addEventListener("click", () =>
    withBusy(saveBtn, async () => {
      const data = await api(`/parties/${eventId}/color`, { method: "PUT", body: { color: withCards() }, token });
      key = null;
      renderSpace(eventId, data);
      toast("Style enregistré");
    }),
  );
  addCardButtons();
}

// Organizer-only floating buttons on the event page: pick a photo / remove it.
function setupBackgroundControl(eventId, token) {
  const picker = document.getElementById("color-picker");
  const open = document.getElementById("color-open");
  open.addEventListener("click", () => {
    picker.hidden = !picker.hidden;
    open.setAttribute("aria-expanded", String(!picker.hidden));
  });
  // What the host is editing: starts from the saved value, previewed live, saved as a whole.
  let style = parseStyle(space.data.event.color);
  const preview = () => applyColor(serializeStyle(style));
  open.addEventListener("click", () => {
    if (picker.hidden) {
      style = parseStyle(space.data.event.color); // closed without saving: drop the preview
      applyColor(space.data.event.color);
    } else {
      document.getElementById("card-style").hidden || closeCardStyle();
    }
  });
  const save = (btn) =>
    withBusy(btn, async () => {
      renderSpace(eventId, await api(`/parties/${eventId}/color`, { method: "PUT", body: { color: serializeStyle(style) }, token }));
      toast("Couleurs mises à jour");
    });
  picker.addEventListener("click", (ev) => {
    const swatch = ev.target.closest("[data-color]");
    if (!swatch) return;
    style = { ...style, theme: swatch.dataset.color, custom: null };
    preview();
    save(swatch);
  });
  const inputs = [...picker.querySelectorAll("input[data-key]")];
  for (const input of inputs) {
    input.addEventListener("input", () => {
      style = { ...style, custom: Object.fromEntries(inputs.map((i) => [i.dataset.key, i.value.toLowerCase()])) };
      preview();
    });
  }
  const saveAll = document.getElementById("color-save");
  saveAll.addEventListener("click", () => save(saveAll));

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

// Marks a rendered block so live updates can swap it on its own (see patchSpace).
function live(key, html) {
  return html ? html.replace(/^(\s*<[a-z]+)/, `$1 data-live="${key}"`) : "";
}

function renderSpace(eventId, data) {
  const { event, me } = data;
  setBackground(eventId, event.background_version);
  applyColor(event.color);
  const identity = getIdentity(eventId);
  // Re-rendering (after an RSVP, a live update…) must not lose what is being typed.
  const draft = space?.eventId === eventId ? captureDraft() : null;
  // Keep the local copy fresh for "Your events".
  setIdentity(eventId, { name: me.name, title: event.title, date: event.date, time: event.time, isHost: me.isHost, justCreated: false });
  document.title = `${event.title} · Party Invite`;
  const html = spaceHtml(eventId, data, identity);
  app.innerHTML = html;
  const comments = setupComments(eventId, me, data.comments || [], identity.token, data.guests || []);
  space = { eventId, data, token: identity.token, parts: liveParts(html), comments, list: document.getElementById("comments") };
  for (const key of space.parts.keys()) bindLive(key);
  bindFrame();
  if (draft) restoreDraft(draft);
  startLiveUpdates();
}

function spaceHtml(eventId, data, identity) {
  const { event, me, guests } = data;

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
  const style = parseStyle(event.color);

  return `
    <nav class="topbar"><a href="/mes-evenements">← Mes événements</a><span class="topbar-right"><span class="hello">${avatar(me.name, "sm")} Salut ${esc(me.name)} 👋</span><button class="bell" id="bell" aria-expanded="false" aria-label="Notifications">🔔<span class="bell-count" id="bell-count" hidden></span></button></span></nav>
    <div class="notif-panel card" id="notif-panel" hidden></div>

    ${live("hero", eventHero(
      eventId,
      event,
      groups.going.length
        ? `<p class="hero-going">${faces(groups.going)} <span>${groups.going.length} ${groups.going.length > 1 ? "viennent" : "vient"}</span></p>`
        : "",
    ))}

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
        ? `<section data-live="info" data-card="info" class="card event-info">
            ${event.address ? `<p class="address">📍 <a href="${mapsUrl(event.address)}" target="_blank" rel="noopener">${esc(event.address)}</a></p>` : ""}
            ${event.description ? `<p class="description">${esc(event.description)}</p>` : ""}
            ${me.isHost ? `<button class="link" id="edit">✏️ Modifier les détails</button>` : ""}
          </section>`
        : ""
    }

    <section data-live="rsvp" data-card="rsvp" class="card">
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

    <section data-live="guests" data-card="guests" class="card">
      <h2>Invités <span class="count">${guests.length}</span></h2>
      ${guestList("going", "Viennent")}
      ${guestList("maybe", "Peut-être")}
      ${guestList("not_going", "Ne viennent pas")}
      ${guestList("none", "Pas encore répondu")}
      ${me.isHost && guests.length > 1 ? `<p class="muted small">👑 Touchez un invité pour en faire un co-hôte, ou pour retirer un doublon.</p>` : ""}
    </section>

    ${live("music", musicSection(event, me, data.spotify))}

    ${live("photos", photosSection(eventId, event, me, data.photos))}

    <section data-card="comments" class="card">
      <h2>💬 Commentaires</h2>
      <ul class="comments" id="comments"></ul>
      <form id="comment-form" class="comment-form" autocomplete="off">
        <ul class="mention-list" id="mention-list" role="listbox" hidden></ul>
        <div class="reply-bar" id="reply-bar" hidden></div>
        <div class="attachments" id="attachments" hidden></div>
        <div class="comment-input" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Votre commentaire" data-placeholder="Écrivez un mot… (@ pour taguer quelqu'un)"></div>
        <div class="composer-bar">
          <button type="button" class="tool" id="emoji-open" aria-expanded="false" aria-label="Ajouter un emoji" title="Emojis">😊</button>
          ${data.gifs ? `<button type="button" class="tool gif-tool" id="gif-open" aria-expanded="false" aria-label="Ajouter un GIF" title="GIFs">GIF</button>` : ""}
          <button type="button" class="tool" id="mention-open" aria-label="Taguer quelqu'un" title="Taguer quelqu'un">@</button>
          ${data.pictures ? `<button type="button" class="tool" id="pic-open" aria-label="Ajouter une photo ou un GIF" title="Photo ou GIF du téléphone">📷</button><input type="file" id="pic-file" accept="image/*" multiple hidden>` : ""}
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
                    `<button class="swatch ${!style.custom && key === style.theme ? "selected" : ""}" data-color="${key}" style="--swatch:${c.accent};--swatch-bg:${c.bg}" aria-label="${esc(c.name)}" title="${esc(c.name)}"></button>`,
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
                    `<label><input type="color" data-key="${key}" value="${(style.custom || COLORS[style.theme])[key]}"> ${label}</label>`,
                )
                .join("")}
            </div>
            <button class="primary" id="color-save">Enregistrer</button>
          </div>
          <div class="card-style-panel" id="card-style" hidden>
            <div class="card-style-head">
              <strong id="card-style-title"></strong>
              <button type="button" class="link small" id="card-style-close">Fermer</button>
            </div>
            ${[
              ["title", "Titre"],
              ["text", "Texte"],
            ]
              .map(
                ([prop, label]) => `<div class="card-style-row">
                  <span class="card-style-label">${label}</span>
                  <select data-prop="${prop}Font" aria-label="Police : ${label.toLowerCase()}"><option value="">Police par défaut</option>${Object.entries(FONTS)
                    .map(([key, f]) => `<option value="${key}" style="font-family:${esc(f.css)}">${esc(f.name)}</option>`)
                    .join("")}</select>
                  <input type="color" data-prop="${prop}" aria-label="Couleur : ${label.toLowerCase()}">
                  <button type="button" class="link small" data-auto="${prop}" title="Couleur par défaut">Auto</button>
                </div>`,
              )
              .join("")}
            <div class="card-style-actions">
              <button type="button" class="link small" id="card-reset">Réinitialiser cette carte</button>
              <button class="primary" id="card-style-save">Enregistrer</button>
            </div>
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
}

// Wires up one live block. Called again whenever patchSpace swaps that block.
// Handlers read space.data so they always see the latest event.
function bindLive(key) {
  const { eventId, token } = space;
  const el = app.querySelector(`[data-live="${key}"]`);
  if (!el) return;
  if (key === "music") setupMusic(eventId, space.data, token);
  if (key === "photos") setupPhotos(eventId, token);
  if (key === "info") el.querySelector("#edit")?.addEventListener("click", () => renderEdit(eventId, space.data));
  if (key === "guests") {
    for (const btn of el.querySelectorAll("[data-host-toggle]")) {
      btn.addEventListener("click", () => {
        const { guests } = space.data;
        const guest = guests.find((g) => g.id === btn.dataset.hostToggle);
        if (guest) guestMenu(eventId, guests, guest, token);
      });
    }
  }
  if (key === "rsvp") {
    for (const btn of el.querySelectorAll("[data-rsvp]")) {
      btn.addEventListener("click", () =>
        withBusy(btn, async () => {
          const before = space.data.me.rsvp;
          const next = await api(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: btn.dataset.rsvp }, token });
          if (btn.dataset.rsvp === "going" && before !== "going") confetti(btn);
          renderSpace(eventId, next);
        }),
      );
    }
  }
}

// Everything outside the live blocks: share box, comment box, host controls…
function bindFrame() {
  const { eventId, data, token } = space;
  const { event, me } = data;
  if (me.isHost) {
    setupBackgroundControl(eventId, token);
    setupCardStyle(eventId, token);
  }

  document.getElementById("rename").addEventListener("click", async () => {
    const name = prompt("Votre prénom", me.name)?.trim();
    if (!name || name === me.name) return;
    try {
      renderSpace(eventId, await api(`/parties/${eventId}/me`, { method: "PATCH", body: { name }, token }));
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
  }
}

// Host menu for one guest: make/unmake co-host, merge a duplicate into someone, or remove.
function guestMenu(eventId, guests, g, token) {
  if (!g) return;
  const others = guests.filter((o) => o.id !== g.id);
  const dlg = document.createElement("dialog");
  dlg.className = "card guest-menu";
  dlg.innerHTML = `
    <h2>${avatar(g.name, "sm")} ${esc(g.name)}</h2>
    <button data-act="host">${g.isHost ? "Retirer des hôtes" : "👑 Faire co-hôte"}</button>
    <h3>Doublon ?</h3>
    <p class="muted small">Si ${esc(g.name)} est la même personne qu'un autre invité, fusionnez : ses commentaires, réactions, chansons, photos et sa réponse passent sur l'autre, et son lien continue de marcher.</p>
    <div class="merge-row">
      <select id="merge-into" aria-label="Fusionner avec">
        <option value="">Fusionner avec…</option>
        ${others.map((o) => `<option value="${esc(o.id)}" ${o.name.trim().toLowerCase() === g.name.trim().toLowerCase() ? "selected" : ""}>${esc(o.name)}${o.isHost ? " (hôte)" : ""}</option>`).join("")}
      </select>
      <button class="primary" data-act="merge">Fusionner</button>
    </div>
    <button class="link remove-guest" data-act="remove">🗑️ Retirer ${esc(g.name)} de l'événement</button>
    <button class="link" data-act="close">Annuler</button>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  const run = (btn, fn) => withBusy(btn, async () => {
    try {
      const msg = await fn();
      dlg.close();
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message);
    }
  });
  const path = `/parties/${eventId}/guests/${encodeURIComponent(g.id)}`;
  dlg.querySelector('[data-act="close"]').addEventListener("click", () => dlg.close());
  dlg.querySelector('[data-act="host"]').addEventListener("click", (e) => {
    const makeHost = !g.isHost;
    if (!confirm(makeHost ? `Faire de ${g.name} un co-hôte ? Il pourra modifier l'événement, les couleurs et la playlist.` : `Retirer ${g.name} des hôtes ?`)) return;
    run(e.currentTarget, async () => {
      renderSpace(eventId, await api(`${path}/host`, { method: "PUT", body: { isHost: makeHost }, token }));
      return makeHost ? `${g.name} est co-hôte 👑` : `${g.name} n'est plus hôte`;
    });
  });
  dlg.querySelector('[data-act="merge"]').addEventListener("click", (e) => {
    const into = others.find((o) => o.id === dlg.querySelector("#merge-into").value);
    if (!into) return toast("Choisissez avec qui fusionner");
    if (!confirm(`Fusionner ${g.name} dans ${into.name} ? ${g.name} disparaît de la liste.`)) return;
    run(e.currentTarget, async () => {
      renderSpace(eventId, await api(`${path}?into=${encodeURIComponent(into.id)}`, { method: "DELETE", token }));
      return `${g.name} fusionné avec ${into.name} ✅`;
    });
  });
  dlg.querySelector('[data-act="remove"]').addEventListener("click", (e) => {
    if (!confirm(`Retirer ${g.name} ? Ses commentaires, réactions, chansons et photos ajoutées seront supprimés. S'il rouvre le lien, il devra rejoindre à nouveau.`)) return;
    run(e.currentTarget, async () => {
      renderSpace(eventId, await api(path, { method: "DELETE", token }));
      return `${g.name} a été retiré`;
    });
  });
  dlg.showModal();
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
    return `<section data-card="music" class="card stack"><h2>🎵 Playlist</h2>
        ${
          spotify.enabled
            ? hostControls + `<p class="muted small center">ou <button class="link small" id="add-playlist">collez le lien d'une playlist</button></p>`
            : `<p class="muted small">Ajoutez une playlist Spotify pour que les invités puissent l'écouter et y ajouter leurs chansons.</p>
               <button id="add-playlist">Ajouter une playlist</button>${hostControls}`
        }</section>`;
  }

  const embed = spotifyEmbed(event.playlist_url);
  const songs = spotify.songs || [];
  return `<section data-card="music" class="card music">
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
      <div data-live="songs">${
        songs.length
          ? `<h3>Ajoutées par les invités <span class="count">${songs.length}</span></h3>
             <ul class="tracks">${songs.map((t) => trackItem(t, `par ${esc(t.addedBy)}`)).join("")}</ul>`
          : ""
      }</div>
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
  // Read at search time: live updates can bring in songs others just added.
  const isAdded = (id) => ((space?.eventId === eventId ? space.data : data).spotify?.songs || []).some((t) => t.trackId === id);
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
                isAdded(t.trackId)
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

// ---------- photo album ----------
// Guests add party photos here, separate from the comments. Each photo is shrunk in the
// browser (about 1600px JPEG, which also strips EXIF/GPS data) plus a small thumbnail for
// the grid, then sent one by one. Tapping a photo opens a full-screen viewer.

const photoUrl = (eventId, id, extra = "") => `/api/parties/${eventId}/photos/${encodeURIComponent(id)}${extra}`;

function photosSection(eventId, event, me, album) {
  if (!album?.enabled) {
    return me.isHost
      ? `<section data-card="photos" class="card"><h2>📸 Photos</h2>
           <p class="muted small">🔌 L'album photo n'est pas encore activé sur le serveur (visible par l'hôte seulement).</p></section>`
      : "";
  }
  const photos = album.photos || [];
  const day = formatWhen(event.date).replace(/ \d{4}$/, "");
  return `<section data-card="photos" class="card photos">
      <h2>📸 Photos ${photos.length ? `<span class="count">${photos.length}</span>` : ""}</h2>
      ${
        album.canUpload
          ? `<div class="photo-add">
               <button class="primary" id="photo-add">📷 Ajouter des photos</button>
               <input type="file" accept="image/*" multiple id="photo-file" hidden>
               <span class="muted small" id="photo-progress" aria-live="polite"></span>
             </div>`
          : `<p class="muted small">🔒 L'album ouvre le jour de la fête (${esc(day)}). Revenez avec vos plus belles photos !</p>`
      }
      ${
        photos.length
          ? `<div class="photo-grid">${photos
              .map(
                (p) =>
                  `<button class="photo-thumb" data-photo="${esc(p.id)}" aria-label="Photo de ${esc(p.name)}"><img src="${esc(photoUrl(eventId, p.id, "?thumb=1"))}" alt="" loading="lazy"></button>`,
              )
              .join("")}</div>`
          : album.canUpload
            ? `<p class="muted small">Pas encore de photos. Soyez le premier ou la première ! Elles restent ici, à part des commentaires.</p>`
            : ""
      }
      ${
        me.isHost
          ? `<label class="photo-setting small"><input type="checkbox" id="photo-party-day" ${album.partyDayOnly ? "checked" : ""}>
               Ouvrir l'album aux invités seulement le jour de la fête</label>`
          : ""
      }
    </section>`;
}

// Draws the image at most `max` px on its longest side and encodes it as JPEG under `maxBytes`.
async function encodeJpeg(bitmap, max, maxBytes) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.72, 0.6, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= maxBytes) return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error("trop lourde");
}

async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file); // follows the EXIF rotation
  try {
    const photo = await encodeJpeg(bitmap, 1600, 1_900_000);
    const thumb = await encodeJpeg(bitmap, 480, 280_000);
    return { photo: photo.blob, thumb: thumb.blob, width: photo.width, height: photo.height };
  } finally {
    bitmap.close?.();
  }
}

async function uploadPhoto(eventId, token, file) {
  const shrunk = await shrinkPhoto(file);
  const form = new FormData();
  form.append("photo", shrunk.photo, "photo.jpg");
  form.append("thumb", shrunk.thumb, "thumb.jpg");
  form.append("width", String(shrunk.width));
  form.append("height", String(shrunk.height));
  let res;
  try {
    res = await fetch(`/api/parties/${eventId}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  } catch {
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function setupPhotos(eventId, token) {
  const el = app.querySelector('[data-live="photos"]');
  if (!el) return;
  for (const btn of el.querySelectorAll("[data-photo]")) {
    btn.addEventListener("click", () => openPhotoViewer(eventId, token, btn.dataset.photo));
  }

  el.querySelector("#photo-party-day")?.addEventListener("change", async (ev) => {
    const box = ev.currentTarget;
    box.disabled = true;
    try {
      const next = await api(`/parties/${eventId}/photos-settings`, { method: "PUT", body: { partyDayOnly: box.checked }, token });
      toast(box.checked ? "L'album ouvrira le jour de la fête 🔒" : "L'album est ouvert à tous 📸");
      box.disabled = false;
      patchSpace(next);
    } catch (err) {
      box.checked = !box.checked;
      box.disabled = false;
      toast(err.message);
    }
  });

  const add = el.querySelector("#photo-add");
  const input = el.querySelector("#photo-file");
  if (!add || !input) return;
  add.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const files = [...input.files].slice(0, 30);
    input.value = "";
    if (!files.length) return;
    const progress = el.querySelector("#photo-progress");
    add.disabled = true; // also keeps live updates from swapping this block mid-upload
    let sent = 0;
    const failed = [];
    for (const [i, file] of files.entries()) {
      progress.textContent = `Envoi ${i + 1}/${files.length}…`;
      try {
        await uploadPhoto(eventId, token, file);
        sent++;
      } catch (err) {
        // Stop on errors that will repeat (album closed or full, too many photos…).
        if ([403, 409, 429, 503].includes(err.status)) {
          failed.push(err.message);
          break;
        }
        failed.push(err.message === "trop lourde" || err instanceof DOMException || !err.status ? `${file.name} : format non pris en charge` : err.message);
      }
    }
    progress.textContent = "";
    add.disabled = false;
    if (sent) toast(`${sent} photo${sent > 1 ? "s" : ""} ajoutée${sent > 1 ? "s" : ""} 📸`);
    if (failed.length) toast(failed[0] + (failed.length > 1 ? ` (+${failed.length - 1} autre${failed.length > 2 ? "s" : ""})` : ""), 5000);
    if (!sent) return;
    try {
      patchSpace(await api(`/parties/${eventId}`, { token }));
    } catch {}
  });
}

// Full-screen viewer: swipe or arrows to move, with who posted it, download and delete.
function openPhotoViewer(eventId, token, photoId) {
  let photos = (space?.eventId === eventId ? space.data.photos?.photos : null) || [];
  let index = photos.findIndex((p) => p.id === photoId);
  if (index < 0) return;
  const dlg = document.createElement("dialog");
  dlg.className = "photo-viewer";
  dlg.innerHTML = `
    <div class="pv-top">
      <span class="pv-who" id="pv-who"></span>
      <span class="pv-count muted" id="pv-count"></span>
      <button class="pv-btn" data-act="close" aria-label="Fermer">✕</button>
    </div>
    <div class="pv-stage">
      <button class="pv-btn pv-nav" data-act="prev" aria-label="Photo précédente">‹</button>
      <img id="pv-img" alt="">
      <button class="pv-btn pv-nav" data-act="next" aria-label="Photo suivante">›</button>
    </div>
    <div class="pv-bottom">
      <a class="pv-btn" id="pv-download" download>⬇️ Enregistrer</a>
      <button class="pv-btn" data-act="delete" id="pv-delete">🗑️ Supprimer</button>
    </div>`;
  document.body.append(dlg);
  const img = dlg.querySelector("#pv-img");
  const show = () => {
    const p = photos[index];
    const me = space.data.me;
    img.src = photoUrl(eventId, p.id);
    img.style.aspectRatio = `${p.width} / ${p.height}`;
    dlg.querySelector("#pv-who").innerHTML = `${avatar(p.name, "sm")} <span><strong>${esc(p.name)}</strong> · ${esc(formatAgo(p.createdAt))}</span>`;
    dlg.querySelector("#pv-count").textContent = photos.length > 1 ? `${index + 1}/${photos.length}` : "";
    dlg.querySelector("#pv-download").href = photoUrl(eventId, p.id, "?download=1");
    dlg.querySelector("#pv-delete").hidden = !(p.guestId === me.id || me.isHost);
    for (const nav of dlg.querySelectorAll(".pv-nav")) nav.hidden = photos.length < 2;
    // Load the neighbours so swiping feels instant.
    for (const n of [index + 1, index - 1]) if (photos[n]) new Image().src = photoUrl(eventId, photos[n].id);
  };
  const go = (step) => {
    if (photos.length < 2) return;
    index = (index + step + photos.length) % photos.length;
    show();
  };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close" || e.target.classList.contains("pv-stage")) dlg.close();
    if (act === "prev") go(-1);
    if (act === "next") go(1);
    if (act === "delete") {
      const p = photos[index];
      if (!confirm(p.guestId === space.data.me.id ? "Supprimer votre photo ?" : `Supprimer la photo de ${p.name} ?`)) return;
      withBusy(e.target.closest("button"), async () => {
        await api(`/parties/${eventId}/photos/${encodeURIComponent(p.id)}`, { method: "DELETE", token });
        toast("Photo supprimée");
        photos = photos.filter((x) => x.id !== p.id);
        try {
          patchSpace(await api(`/parties/${eventId}`, { token }));
        } catch {}
        if (!photos.length) return dlg.close();
        index = Math.min(index, photos.length - 1);
        show();
      });
    }
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  });
  let touchX = null;
  img.addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  img.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  });
  show();
  dlg.showModal();
}

// ---------- live updates ----------
// While an event page is open we re-fetch it every few seconds (and as soon as the tab
// comes back), then only swap the blocks that changed: comments, RSVPs, guests, songs…
// Polling keeps it simple: D1 reads are cheap and nothing needs a socket to stay open.

const LIVE_EVERY = 8000;
let space = null; // the event page on screen: { eventId, data, token, parts, comments, list }
let liveTimer = null;
let liveBusy = false;

function stopLiveUpdates() {
  clearInterval(liveTimer);
  liveTimer = null;
}

function startLiveUpdates() {
  stopLiveUpdates();
  liveTimer = setInterval(liveTick, LIVE_EVERY);
}

const liveOnScreen = () => space && document.body.contains(space.list);

async function liveTick() {
  if (!liveOnScreen() || document.hidden || liveBusy) return;
  liveBusy = true;
  const { eventId, token } = space;
  try {
    const data = await api(`/parties/${eventId}`, { token });
    if (!liveOnScreen() || space.eventId !== eventId) return;
    if (data.preview) return renderEvent(eventId); // we were removed from the guest list
    space.comments.update(data.comments || [], data.guests || []);
    patchSpace(data);
  } catch (err) {
    // Event deleted by the host: say so. Otherwise (offline…) try again next tick.
    if (err.status === 404) renderEvent(eventId);
  } finally {
    liveBusy = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) liveTick();
});
window.addEventListener("online", () => liveTick());

// The HTML of each live block, with nested live blocks left out, plus the HTML of the
// rest of the page ("frame"). Comparing these strings tells us exactly what changed.
function liveParts(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const parts = new Map();
  for (const el of tpl.content.querySelectorAll("[data-live]")) {
    const own = el.cloneNode(true);
    for (const inner of own.querySelectorAll("[data-live]")) inner.replaceWith(`[${inner.dataset.live}]`);
    parts.set(el.dataset.live, { el, html: own.outerHTML });
  }
  const frame = tpl.content.cloneNode(true);
  for (const el of frame.querySelectorAll("[data-live]")) el.replaceWith(`[${el.dataset.live}]`);
  const div = document.createElement("div");
  div.append(frame);
  parts.set("", { html: div.innerHTML });
  return parts;
}

// Someone is in the middle of something here: don't pull the rug.
function inUse(el) {
  const a = document.activeElement;
  if (a && a !== document.body && el.contains(a) && a.matches("input, textarea, select, [contenteditable]")) return true;
  if ([...el.querySelectorAll("button")].some((b) => b.disabled)) return true; // request on its way
  const search = el.querySelector("#song-search input");
  return !!(search && search.value.trim());
}

// The host has the color picker or a card's style sheet open, with an unsaved preview.
function previewing() {
  return ["color-picker", "card-style"].some((id) => document.getElementById(id)?.hidden === false);
}

function patchSpace(data) {
  const { eventId } = space;
  const identity = getIdentity(eventId);
  if (!identity) return;
  const html = spaceHtml(eventId, data, identity);
  const next = liveParts(html);
  const prev = space.parts;
  if (next.get("").html === prev.get("").html && [...next.keys()].join() === [...prev.keys()].join()) {
    // Same page layout: swap only the blocks that changed.
    space.data = data;
    setBackground(eventId, data.event.background_version);
    if (!previewing()) applyColor(data.event.color);
    for (const [key, part] of next) {
      if (!key || part.html === prev.get(key).html) continue;
      const old = app.querySelector(`[data-live="${key}"]`);
      if (!old) continue;
      if (inUse(old)) {
        part.html = prev.get(key).html; // try again next tick
        continue;
      }
      const fresh = part.el.cloneNode(true);
      // Keep nested blocks that didn't change (e.g. the Spotify player while only the song list moved).
      for (const inner of fresh.querySelectorAll("[data-live]")) {
        const k = inner.dataset.live;
        if (next.get(k).html === prev.get(k).html) {
          const keep = old.querySelector(`[data-live="${k}"]`);
          if (keep) inner.replaceWith(keep);
        }
      }
      old.replaceWith(fresh);
      bindLive(key);
    }
    addCardButtons();
    space.parts = next;
    return;
  }
  // The layout itself changed (made co-host, new address, new colors…): redraw the page,
  // unless a menu or the color picker is open, then wait for the next tick.
  if (document.querySelector("dialog[open]") || previewing()) return;
  const y = window.scrollY;
  renderSpace(eventId, data);
  window.scrollTo(0, y);
}

// What is typed in the comment box (and what it answers), so a redraw can put it back.
function captureDraft() {
  const textarea = plainEditor(document.querySelector("#comment-form .comment-input"));
  if (!textarea || !space?.comments) return null;
  return {
    value: textarea.value,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    focused: document.activeElement === textarea,
    replyTo: space.comments.replyTo(),
    listScroll: space.list?.scrollTop ?? null,
  };
}

function restoreDraft(draft) {
  const textarea = plainEditor(document.querySelector("#comment-form .comment-input"));
  if (!textarea) return;
  textarea.value = draft.value;
  if (draft.replyTo) space.comments.setReply(draft.replyTo);
  if (draft.focused) {
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(draft.start, draft.end);
  }
  if (draft.listScroll != null && space.list) space.list.scrollTop = draft.listScroll;
}

// ---------- comment wall ----------

// The comment box is a contenteditable div rather than a <textarea>: phone keyboards
// (Gboard, Samsung) only enable their GIF/sticker button in fields that accept rich
// content. We keep it plain text and give it the bits of the textarea API we use
// (value, selectionStart/End, setSelectionRange), so the rest of the code doesn't care.
function plainEditor(el) {
  if (!el || el._plain) return el;
  el._plain = true;

  // Caret position as an offset into the text.
  const offsetOf = (node, offset) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(node, offset);
    return range.toString().length;
  };
  const selection = () => {
    const sel = getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    return [offsetOf(r.startContainer, r.startOffset), offsetOf(r.endContainer, r.endOffset)];
  };
  const pointAt = (pos) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let last = null;
    while ((node = walker.nextNode())) {
      if (pos <= node.length) return [node, pos];
      pos -= node.length;
      last = node;
    }
    return last ? [last, last.length] : [el, 0];
  };
  const text = () => el.textContent;
  const setText = (value) => {
    el.textContent = value;
    // A trailing newline only shows (and takes the caret) with something after it.
    if (value.endsWith("\n")) el.append(Object.assign(document.createElement("br"), { className: "end" }));
    el.classList.toggle("empty", !value);
  };

  Object.defineProperties(el, {
    value: { get: text, set: setText },
    selectionStart: { get: () => selection()?.[0] ?? text().length },
    selectionEnd: { get: () => selection()?.[1] ?? text().length },
  });
  el.setSelectionRange = (start, end = start) => {
    const range = document.createRange();
    range.setStart(...pointAt(start));
    range.setEnd(...pointAt(end));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const insertText = (str) => {
    const [start, end] = selection() || [text().length, text().length];
    setText(text().slice(0, start) + str + text().slice(end));
    el.setSelectionRange(start + str.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // Keep it plain text: new lines become "\n", pasted rich text becomes text, and
  // anything else the browser slips in (a <div>, a <br>, an <img>) is flattened.
  el.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertParagraph" || ev.inputType === "insertLineBreak") {
      ev.preventDefault();
      insertText("\n");
    }
  });
  el.addEventListener("paste", (ev) => {
    const files = [...(ev.clipboardData?.files || [])];
    ev.preventDefault();
    if (files.length) {
      el.dispatchEvent(new CustomEvent("media", { detail: files }));
      return;
    }
    insertText((ev.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n"));
  });
  el.addEventListener("drop", (ev) => {
    const files = [...(ev.dataTransfer?.files || [])];
    if (!files.length) return;
    ev.preventDefault();
    el.dispatchEvent(new CustomEvent("media", { detail: files }));
  });
  el.addEventListener("input", () => {
    if (el.querySelector("*:not(br.end)") || el.querySelectorAll("br").length > 1) {
      // Something rich got in (e.g. a keyboard inserted an image): keep only the text.
      const imgs = [...el.querySelectorAll("img")].map((i) => i.src).filter(Boolean);
      const pos = el.selectionStart;
      setText(el.innerText.replace(/\n$/, ""));
      el.setSelectionRange(Math.min(pos, text().length));
      if (imgs.length) el.dispatchEvent(new CustomEvent("media", { detail: imgs }));
    }
    el.classList.toggle("empty", !text());
  });
  el.classList.toggle("empty", !text());
  return el;
}

const EMOJIS = [
  "😂", "🥰", "😍", "😘", "😎", "🤩", "🥳", "😭", "🤣", "😅", "🙏", "👏",
  "🙌", "💃", "🕺", "👀", "🔥", "✨", "🎉", "🎊", "🍾", "🥂", "🍷", "🍸",
  "🍕", "🥐", "🧀", "🎶", "🎵", "🚇", "🗼", "🇫🇷", "❤️", "💜", "💖", "👍",
  "😴", "🤔", "🙈", "😱", "💯", "🫶",
];

const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉", "👍"];

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

const REPLY_LINE = /^\[reply:([A-Za-z0-9_-]{1,40})\]$/;

// Splits a stored comment into its text, the GIFs it carries ("[gif:ID]" lines) and the
// comment it answers (a first "[reply:ID]" line).
// Photos/GIFs from the phone: "[img:ID:WxH]" lines, files served by the Worker from R2.
const IMG_LINE = /^\[img:([A-Za-z0-9_-]{8,40}):(\d+)x(\d+)\]$/;

function parseComment(body) {
  const gifs = [];
  const pics = [];
  const lines = [];
  let replyTo = null;
  for (const [i, line] of body.split("\n").entries()) {
    const r = i === 0 && line.trim().match(REPLY_LINE);
    const m = line.trim().match(GIF_LINE);
    const p = line.trim().match(IMG_LINE);
    if (r) replyTo = r[1];
    else if (m) gifs.push(m[1]);
    else if (p) pics.push({ id: p[1], width: +p[2], height: +p[3] });
    else lines.push(line);
  }
  return { text: lines.join("\n").trim(), gifs, pics, replyTo };
}

const mediaLabel = ({ gifs, pics }) => (pics.length ? "📷 Photo" : gifs.length ? "GIF" : "");

// One-line preview of a comment for quotes.
function quoteText(body) {
  const parsed = parseComment(body);
  const t = parsed.text.replace(/\s+/g, " ");
  return (t.length > 80 ? t.slice(0, 77) + "…" : t) || mediaLabel(parsed);
}

function mentionsMe(text, myName) {
  const re = new RegExp(`@${escRe(myName)}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

// Pictures waiting to go out with the next comment. Kept outside setupComments so a
// redraw of the page (live updates) doesn't drop them.
const MAX_COMMENT_PICS = 4;
let pendingPics = [];

// Photos are shrunk like album photos; GIFs are sent as they are so they keep moving.
async function uploadCommentPicture(eventId, token, file) {
  let blob = file;
  let width;
  let height;
  if (file.type === "image/gif" && file.size <= 4_000_000) {
    const bitmap = await createImageBitmap(file);
    [width, height] = [bitmap.width, bitmap.height];
    bitmap.close?.();
  } else {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Impossible de lire cette image");
    }
    try {
      ({ blob, width, height } = await encodeJpeg(bitmap, 1600, 1_900_000));
    } finally {
      bitmap.close?.();
    }
  }
  let res;
  try {
    res = await fetch(`/api/parties/${eventId}/comment-images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    });
  } catch {
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion.");
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Erreur (${res.status})`);
  return `[img:${out.id}:${width}x${height}]`;
}

function setupComments(eventId, me, initial, token, guests) {
  const list = document.getElementById("comments");
  const form = document.getElementById("comment-form");
  const textarea = plainEditor(form.querySelector(".comment-input"));
  const sendBtn = form.querySelector("button[type=submit]");
  let lastKey = null;
  // Everyone we can tag: guests, plus authors of comments (in case someone joined since).
  const people = new Map(guests.map((g) => [g.id, g.name]));
  let currentComments = initial;

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
    const parsed = parseComment(body);
    const t = parsed.text.length > 60 ? parsed.text.slice(0, 57) + "…" : parsed.text;
    return t || mediaLabel(parsed);
  };

  function updateNotifications(comments) {
    const list = [];
    const byId = new Map(comments.map((c) => [c.id, c]));
    for (const c of comments) {
      const parsed = parseComment(c.body);
      if (c.guestId !== me.id && parsed.replyTo && byId.get(parsed.replyTo)?.guestId === me.id) {
        list.push({ kind: "reply", from: c.name, at: c.createdAt, id: c.id, text: snippet(c.body) });
        continue;
      }
      if (c.guestId === me.id) {
        for (const l of c.likes || []) {
          if (l.guestId !== me.id) list.push({ kind: "like", emoji: l.emoji || "❤️", from: l.name, at: l.at, id: c.id, text: snippet(c.body) });
        }
      } else if (mentionsMe(parsed.text, me.name)) {
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

  const notifVerb = (n) =>
    n.kind === "like" ? `a réagi ${n.emoji} à votre commentaire` : n.kind === "reply" ? "a répondu à votre commentaire" : "vous a tagué·e";
  const notifText = (n) => `${n.kind === "like" ? n.emoji : n.kind === "reply" ? "↩️" : "💬"} ${n.from} ${notifVerb(n)}`;

  function drawPanel(seen) {
    panel.innerHTML = `<h2>Notifications</h2>${
      notifs.length
        ? `<ul class="notifs">${notifs
            .map(
              (n) => `<li class="${n.at > seen ? "unread" : ""}"><button data-goto="${esc(n.id)}">
                ${avatar(n.from, "sm")}
                <span class="notif-text"><span><strong>${esc(n.from)}</strong> ${esc(notifVerb(n))}${n.text ? ` : « ${esc(n.text)} »` : ""}</span>
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
    currentComments = comments;
    for (const c of comments) people.set(c.guestId, c.name);
    updateNotifications(comments);
    const key = comments.map((c) => c.id + c.name + (c.likes || []).map((l) => l.guestId + l.emoji).join("+")).join();
    if (key === lastKey) {
      // Same comments: just refresh the "x min ago" labels.
      for (const el of list.querySelectorAll("[data-at]")) el.textContent = formatAgo(el.dataset.at);
      return;
    }
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    lastKey = key;
    const names = [...people.values()];
    const byId = new Map(comments.map((c) => [c.id, c]));
    list.innerHTML = comments.length
      ? comments
          .map((c) => {
            const { text, gifs, pics, replyTo } = parseComment(c.body);
            const parent = replyTo ? byId.get(replyTo) : null;
            const quote = replyTo
              ? parent
                ? `<button class="quote" data-goto-comment="${esc(parent.id)}"><strong>${esc(parent.name)}</strong><span>${esc(quoteText(parent.body))}</span></button>`
                : `<div class="quote gone"><span>Message supprimé</span></div>`
              : "";
            const mine = c.guestId === me.id;
            const tagged = !mine && mentionsMe(text, me.name);
            const likes = c.likes || [];
            const myEmoji = likes.find((l) => l.guestId === me.id)?.emoji || "";
            const groups = new Map();
            for (const l of likes) groups.set(l.emoji || "❤️", [...(groups.get(l.emoji || "❤️") || []), l.guestId === me.id ? "Vous" : l.name]);
            const likers = likes.map((l) => `${l.guestId === me.id ? "Vous" : l.name} ${l.emoji || "❤️"}`).join(", ");
            return `<li id="c-${esc(c.id)}" class="${mine ? "mine" : ""} ${tagged ? "tagged" : ""}">
              ${avatar(c.name)}
              <div class="comment-body">
                <div class="comment-meta"><strong>${esc(c.name)}</strong>
                  <span class="muted small" data-at="${esc(c.createdAt)}">${esc(formatAgo(c.createdAt))}</span>
                  <span class="comment-actions">
                    ${mine ? "" : `<button class="link small" data-reply="${esc(c.id)}" data-reply-name="${esc(c.name)}">Répondre</button>`}
                    ${mine || me.isHost ? `<button class="link small delete" data-delete="${esc(c.id)}" aria-label="Supprimer le commentaire">Supprimer</button>` : ""}
                  </span>
                </div>
                ${quote}
                ${text ? `<p>${formatCommentText(text, names, me.name)}</p>` : ""}
                ${gifs.map((id) => `<img class="comment-gif" src="${gifUrl(id)}" alt="GIF" loading="lazy">`).join("")}
                ${
                  pics.length
                    ? `<div class="comment-pics ${pics.length > 1 ? "multi" : ""}">${pics
                        .map((p) => {
                          const src = `/api/parties/${esc(eventId)}/comment-images/${esc(p.id)}`;
                          return `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="Photo" loading="lazy" width="${p.width}" height="${p.height}"></a>`;
                        })
                        .join("")}</div>`
                    : ""
                }
                <div class="comment-foot">
                  ${[...groups]
                    .map(
                      ([e, names]) =>
                        `<button class="reaction ${e === myEmoji ? "on" : ""}" data-react="${esc(c.id)}" data-emoji="${esc(e)}" aria-pressed="${e === myEmoji}" title="${esc(names.join(", "))}">${esc(e)} <span>${names.length}</span></button>`,
                    )
                    .join("")}
                  <button class="reaction add" data-react-open="${esc(c.id)}" aria-label="Réagir" title="Réagir">${likes.length ? "＋" : "😊＋"}</button>
                </div>
                ${likes.length ? `<p class="muted small likers">${esc(likers)}</p>` : ""}
                <div class="react-bar" data-bar="${esc(c.id)}" hidden>
                  ${QUICK_REACTIONS.map((e) => `<button type="button" data-react="${esc(c.id)}" data-emoji="${e}" class="${e === myEmoji ? "on" : ""}">${e}</button>`).join("")}
                  <button type="button" class="more" data-react-more aria-label="Plus d'emojis">⋯</button>
                  <div class="react-more" hidden>${EMOJIS.filter((e) => !QUICK_REACTIONS.includes(e)).map((e) => `<button type="button" data-react="${esc(c.id)}" data-emoji="${e}" class="${e === myEmoji ? "on" : ""}">${e}</button>`).join("")}</div>
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

  // Replying quotes the comment above the text box; the reply is sent with a
  // "[reply:ID]" first line so everyone sees what it answers.
  const replyBar = document.getElementById("reply-bar");
  let replyTo = null;
  const setReply = (comment) => {
    replyTo = comment ? comment.id : null;
    replyBar.hidden = !comment;
    replyBar.innerHTML = comment
      ? `<span class="reply-label"><span>↩️ Réponse à <strong>${esc(comment.name)}</strong></span><span class="muted">${esc(quoteText(comment.body))}</span></span>
         <button type="button" class="link small" id="reply-cancel" aria-label="Annuler la réponse">✕</button>`
      : "";
  };
  replyBar.addEventListener("click", (ev) => {
    if (ev.target.closest("#reply-cancel")) setReply(null);
  });

  const reply = (commentId) => {
    const comment = currentComments.find((c) => c.id === commentId);
    if (comment) setReply(comment);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  list.addEventListener("click", async (ev) => {
    const replyBtn = ev.target.closest("[data-reply]");
    if (replyBtn) return reply(replyBtn.dataset.reply);
    const quoteBtn = ev.target.closest("[data-goto-comment]");
    if (quoteBtn) {
      const target = document.getElementById(`c-${quoteBtn.dataset.gotoComment}`);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.remove("flash");
        void target.offsetWidth;
        target.classList.add("flash");
      }
      return;
    }
    const openBtn = ev.target.closest("[data-react-open]");
    if (openBtn) return toggleBar(openBtn.dataset.reactOpen);
    const moreBtn = ev.target.closest("[data-react-more]");
    if (moreBtn) {
      moreBtn.hidden = true;
      moreBtn.nextElementSibling.hidden = false;
      return;
    }
    const reactBtn = ev.target.closest("[data-react]");
    if (reactBtn) {
      // Tapping your own reaction again removes it; any other emoji replaces it.
      const commentId = reactBtn.dataset.react;
      const emoji = reactBtn.dataset.emoji;
      const mine = list.querySelector(`li[id="c-${CSS.escape(commentId)}"] .reaction.on`)?.dataset.emoji;
      const body = mine === emoji ? { liked: false } : { liked: true, emoji };
      return withBusy(reactBtn, async () => {
        draw((await api(`/parties/${eventId}/comments/${commentId}/like`, { method: "PUT", body, token })).comments);
      });
    }
    const btn = ev.target.closest("[data-delete]");
    if (!btn || !confirm("Supprimer ce commentaire ?")) return;
    withBusy(btn, async () => {
      draw((await api(`/parties/${eventId}/comments/${btn.dataset.delete}`, { method: "DELETE", token })).comments);
    });
  });

  function toggleBar(commentId, open) {
    for (const bar of list.querySelectorAll("[data-bar]")) {
      const show = bar.dataset.bar === commentId && (open ?? bar.hidden);
      bar.hidden = !show;
    }
  }

  // Long-press a comment (like WhatsApp) to open its reaction bar.
  let pressTimer = null;
  list.addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest("li[id^='c-']");
    if (!li || ev.target.closest("button, a, .react-bar")) return;
    pressTimer = setTimeout(() => {
      toggleBar(li.id.slice(2), true);
      navigator.vibrate?.(10);
    }, 450);
  });
  for (const type of ["pointerup", "pointercancel", "pointermove", "scroll"]) {
    list.addEventListener(type, (ev) => {
      if (type === "pointermove" && Math.abs(ev.movementX) + Math.abs(ev.movementY) < 3) return;
      clearTimeout(pressTimer);
    });
  }
  list.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest("li[id^='c-']") && !ev.target.closest("a, img")) ev.preventDefault();
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
      .slice(0, 8);
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
  // Hide suggestions when focus really leaves the text box (the @ button hands focus straight back).
  textarea.addEventListener("blur", () =>
    setTimeout(() => {
      if (document.activeElement !== textarea) mentionList.hidden = true;
    }, 150),
  );
  const mentionBtn = document.getElementById("mention-open");
  mentionBtn.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep the keyboard open
  mentionBtn.addEventListener("click", () => {
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
    // Upload the attached pictures first, then post the comment pointing to them.
    const pending = pendingPics.filter((p) => p.eventId === eventId);
    if (pending.length) {
      const lines = [];
      for (const pic of pending) lines.push(await uploadCommentPicture(eventId, token, pic.file));
      body = [body, ...lines].filter(Boolean).join("\n");
    }
    if (replyTo) body = `[reply:${replyTo}]\n${body}`;
    const { comments } = await api(`/parties/${eventId}/comments`, { method: "POST", body: { body }, token });
    textarea.value = "";
    setReply(null);
    clearPics();
    toggle(emojiBtn, emojiPanel, false);
    if (gifPanel) toggle(gifBtn, gifPanel, false);
    lastKey = null;
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

  // ----- photos and GIFs from the phone -----
  // Picked with 📷, pasted, dropped, or (once browsers allow it) sent by the keyboard.
  // They wait as thumbnails above the text box and go out with the next "Envoyer".
  const attachments = document.getElementById("attachments");
  const drawPics = () => {
    const mine = pendingPics.filter((p) => p.eventId === eventId);
    attachments.hidden = !mine.length;
    attachments.innerHTML = mine
      .map((p, i) => `<span class="attachment"><img src="${p.url}" alt=""><button type="button" data-unpick="${i}" aria-label="Retirer">✕</button></span>`)
      .join("");
  };
  const clearPics = () => {
    for (const p of pendingPics) URL.revokeObjectURL(p.url);
    pendingPics = [];
    drawPics();
  };
  const addPics = (files) => {
    if (!document.getElementById("pic-open")) return toast("Les photos ne sont pas encore activées sur ce site");
    const images = [...files].filter((f) => f instanceof File && f.type.startsWith("image/"));
    if (!images.length) return toast("Ce fichier n'est pas une image");
    for (const file of images) {
      if (pendingPics.length >= MAX_COMMENT_PICS) {
        toast(`${MAX_COMMENT_PICS} images maximum par commentaire`);
        break;
      }
      pendingPics.push({ eventId, file, url: URL.createObjectURL(file) });
    }
    drawPics();
  };
  if (pendingPics.some((p) => p.eventId !== eventId)) clearPics();
  drawPics();
  attachments.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-unpick]");
    if (!btn) return;
    const [removed] = pendingPics.splice(Number(btn.dataset.unpick), 1);
    URL.revokeObjectURL(removed.url);
    drawPics();
  });
  textarea.addEventListener("media", (ev) => {
    const files = ev.detail.filter((f) => f instanceof File);
    if (files.length) addPics(files);
    else toast("Ce clavier n'envoie pas encore d'images à ce site : utilisez le bouton 📷");
  });
  const picBtn = document.getElementById("pic-open");
  const picFile = document.getElementById("pic-file");
  if (picBtn) {
    picBtn.addEventListener("click", () => picFile.click());
    picFile.addEventListener("change", () => {
      addPics(picFile.files);
      picFile.value = "";
    });
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const body = textarea.value.trim().slice(0, 1000);
    if (!body && !pendingPics.some((p) => p.eventId === eventId)) return;
    withBusy(sendBtn, () => send(body));
  });

  // Used by the live updates (see liveTick) and to keep a draft across redraws.
  return {
    update(comments, guests) {
      for (const g of guests) people.set(g.id, g.name);
      draw(comments);
    },
    replyTo: () => replyTo,
    setReply(id) {
      const comment = currentComments.find((c) => c.id === id);
      if (comment) setReply(comment);
    },
  };
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
  stopLiveUpdates();
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
