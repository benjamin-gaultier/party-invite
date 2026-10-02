// Party Invite frontend: no framework, no build step.
// Routes: "/" (create an event + your events) and "/e/:id" (an event).

const app = document.getElementById("app");
const STORE_KEY = "party-invite:v1";

// ---------- local identity ----------
// Per event we keep { guestId, token, name, title, date }. The token is what
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
    throw new Error("Couldn't reach the server. Check your connection, or pause your ad blocker for this site.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- tiny view helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2500);
}

function formatWhen(date, time) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: new Date().getFullYear() === y ? undefined : "numeric",
  });
  if (!time) return day;
  const [hh, mm] = time.split(":").map(Number);
  const t = new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t}`;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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

// ---------- home: create event + your events ----------

function renderHome() {
  document.title = "Party Invite";
  const store = loadStore();
  const today = new Date().toISOString().slice(0, 10);
  const mine = Object.entries(store.events)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const upcoming = mine.filter((e) => !e.date || e.date >= today);
  const past = mine.filter((e) => e.date && e.date < today).reverse();

  const list = (items) =>
    items
      .map(
        (e) => `<li><a class="event-link" href="/e/${esc(e.id)}">
          <strong>${esc(e.title || "Untitled event")}</strong>
          <span class="muted">${esc(formatWhen(e.date, e.time))}</span></a></li>`,
      )
      .join("");

  app.innerHTML = `
    <header class="hero">
      <div class="emoji">🎉</div>
      <h1>Throw a party</h1>
      <p class="muted">Create an event, share one link. Guests join with just their name, no app or account.</p>
    </header>

    <form id="create" class="card stack" autocomplete="off">
      <label>What's the occasion?
        <input name="title" required maxlength="120" placeholder="Banu's birthday 🎂">
      </label>
      <div class="row">
        <label>Date <input name="date" type="date" required min="${today}"></label>
        <label>Time <input name="time" type="time"></label>
      </div>
      <label>Address
        <input name="address" maxlength="300" placeholder="Street, city">
      </label>
      <label>Details <span class="muted">(optional)</span>
        <textarea name="description" rows="3" maxlength="2000" placeholder="Bring a bottle, costumes welcome…"></textarea>
      </label>
      <label>Your name
        <input name="hostName" required maxlength="40" placeholder="So guests know who's hosting" value="${esc(store.lastName)}">
      </label>
      <button class="primary" type="submit">Create event &amp; get link</button>
    </form>

    ${upcoming.length ? `<section class="stack"><h2>Your upcoming events</h2><ul class="events">${list(upcoming)}</ul></section>` : ""}
    ${past.length ? `<section class="stack"><h2>Past events</h2><ul class="events">${list(past)}</ul></section>` : ""}
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
        justCreated: true,
      });
      navigate(`/e/${eventId}`);
    });
  });
}

// ---------- event page ----------

async function renderEvent(eventId) {
  const identity = getIdentity(eventId);
  let data;
  try {
    data = await api(`/parties/${eventId}`, { token: identity?.token });
  } catch (err) {
    return renderMessage(err.status === 404 ? "This event doesn't exist (or the link is incomplete)." : err.message);
  }

  if (data.preview) {
    // Token missing or no longer valid: ask for a name.
    if (identity) forgetIdentity(eventId);
    return renderJoin(eventId, data.preview);
  }
  renderSpace(eventId, data);
}

function renderJoin(eventId, preview) {
  document.title = `${preview.title} · Party Invite`;
  const store = loadStore();
  app.innerHTML = `
    <header class="hero">
      <div class="emoji">💌</div>
      <p class="muted">${preview.hostName ? `${esc(preview.hostName)} invited you to` : "You're invited to"}</p>
      <h1>${esc(preview.title)}</h1>
      <p class="when">${esc(formatWhen(preview.date, preview.time))}</p>
      ${preview.going ? `<p class="muted">${preview.going} going so far</p>` : ""}
    </header>
    <form id="join" class="card stack" autocomplete="off">
      <label>What's your name?
        <input name="name" required maxlength="40" placeholder="Your name" value="${esc(store.lastName)}" autofocus>
      </label>
      <button class="primary" type="submit">Join the party</button>
      <p class="muted small center">No account needed. This browser will remember you.</p>
    </form>
  `;
  const form = document.getElementById("join");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = new FormData(form).get("name").trim();
    withBusy(form.querySelector("button"), async () => {
      const { guest } = await api(`/parties/${eventId}/join`, { method: "POST", body: { name } });
      setIdentity(eventId, { guestId: guest.id, token: guest.token, name, title: preview.title, date: preview.date, time: preview.time });
      renderEvent(eventId);
    });
  });
}

const RSVP_LABELS = { going: "Going", maybe: "Maybe", not_going: "Can't go" };
const RSVP_EMOJI = { going: "🥳", maybe: "🤔", not_going: "😢" };

function renderSpace(eventId, data) {
  const { event, me, guests } = data;
  const identity = getIdentity(eventId);
  // Keep the local copy fresh for "Your events".
  setIdentity(eventId, { name: me.name, title: event.title, date: event.date, time: event.time, justCreated: false });
  document.title = `${event.title} · Party Invite`;

  const groups = { going: [], maybe: [], not_going: [], none: [] };
  for (const g of guests) groups[g.rsvp || "none"].push(g);
  const guestList = (key, label) =>
    groups[key].length
      ? `<div class="guest-group"><h3>${label} <span class="count">${groups[key].length}</span></h3>
         <ul class="guests">${groups[key]
           .map(
             (g) => `<li>${esc(g.name)}${g.isHost ? ' <span class="badge">host</span>' : ""}${g.id === me.id ? ' <span class="badge you">you</span>' : ""}</li>`,
           )
           .join("")}</ul></div>`
      : "";

  app.innerHTML = `
    <nav class="topbar"><a href="/">← Your events</a><span class="muted">Hi ${esc(me.name)} 👋</span></nav>

    ${
      me.isHost
        ? `<section class="card share ${identity?.justCreated ? "highlight" : ""}">
            <h2>${identity?.justCreated ? "Your event is live! 🎉" : "Invite people"}</h2>
            <p class="muted small">Anyone with this link can join.</p>
            <div class="share-row">
              <input readonly value="${esc(shareUrl(eventId))}" id="share-url">
              <button id="copy">Copy</button>
            </div>
            <div class="share-buttons">
              <a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${event.title} 🎉 ${shareUrl(eventId)}`)}">WhatsApp</a>
              <button id="native-share" hidden>Share…</button>
            </div>
          </section>`
        : ""
    }

    <section class="card event-info">
      <h1>${esc(event.title)}</h1>
      <p class="when">📅 ${esc(formatWhen(event.date, event.time))}</p>
      ${event.address ? `<p>📍 <a href="${mapsUrl(event.address)}" target="_blank" rel="noopener">${esc(event.address)}</a></p>` : ""}
      ${event.description ? `<p class="description">${esc(event.description)}</p>` : ""}
      ${me.isHost ? `<button class="link" id="edit">Edit details</button>` : ""}
    </section>

    <section class="card">
      <h2>Are you coming?</h2>
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
      <h2>Guests <span class="count">${guests.length}</span></h2>
      ${guestList("going", "Going")}
      ${guestList("maybe", "Maybe")}
      ${guestList("not_going", "Can't go")}
      ${guestList("none", "Haven't answered")}
    </section>

    <p class="center small"><button class="link" id="rename">Change my name</button></p>
  `;

  for (const btn of app.querySelectorAll("[data-rsvp]")) {
    btn.addEventListener("click", () =>
      withBusy(btn, async () => {
        const next = await api(`/parties/${eventId}/rsvp`, { method: "PUT", body: { status: btn.dataset.rsvp }, token: identity.token });
        renderSpace(eventId, next);
      }),
    );
  }

  document.getElementById("rename").addEventListener("click", async () => {
    const name = prompt("Your name", me.name)?.trim();
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
      toast("Link copied");
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

function renderEdit(eventId, data) {
  const { event } = data;
  const identity = getIdentity(eventId);
  app.innerHTML = `
    <nav class="topbar"><a href="/e/${esc(eventId)}" id="back">← Back</a></nav>
    <form id="edit-form" class="card stack" autocomplete="off">
      <h2>Edit event</h2>
      <label>Title <input name="title" required maxlength="120" value="${esc(event.title)}"></label>
      <div class="row">
        <label>Date <input name="date" type="date" required value="${esc(event.date)}"></label>
        <label>Time <input name="time" type="time" value="${esc(event.time)}"></label>
      </div>
      <label>Address <input name="address" maxlength="300" value="${esc(event.address)}"></label>
      <label>Details <textarea name="description" rows="4" maxlength="2000">${esc(event.description)}</textarea></label>
      <button class="primary" type="submit">Save</button>
    </form>
  `;
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
      toast("Saved");
    });
  });
}

function renderMessage(text) {
  app.innerHTML = `<section class="card center stack"><div class="emoji">🤷</div><p>${esc(text)}</p><a class="btn primary" href="/">Create an event</a></section>`;
}

// ---------- router ----------

function route() {
  const match = location.pathname.match(/^\/e\/([A-Za-z0-9_-]+)\/?$/);
  window.scrollTo(0, 0);
  if (match) renderEvent(match[1]);
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
