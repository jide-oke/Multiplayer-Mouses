const statusEl = document.getElementById("status");
const stage = document.getElementById("stage");

const users = new Map();
let selfId = null;
let latestMove = null;
let sendTimer = null;
let locationSent = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function ensureCursor(user) {
  let entry = users.get(user.id);
  if (entry) {
    applyUserIdentity(entry, user);
    if (typeof user.x === "number") {
      entry.x = user.x;
    }
    if (typeof user.y === "number") {
      entry.y = user.y;
    }
    renderCursor(entry);
    return entry;
  }

  const node = document.createElement("div");
  node.className = "cursor";
  node.style.background = user.color;

  const label = document.createElement("span");
  label.className = "cursor-label";

  const badge = document.createElement("span");
  badge.className = "cursor-badge";

  const name = document.createElement("span");
  name.className = "cursor-name";

  const place = document.createElement("span");
  place.className = "cursor-place";

  label.appendChild(badge);
  label.appendChild(name);
  label.appendChild(place);
  node.appendChild(label);
  stage.appendChild(node);

  const initialX = typeof user.x === "number" ? user.x : stage.clientWidth / 2;
  const initialY = typeof user.y === "number" ? user.y : stage.clientHeight / 2;
  entry = {
    ...user,
    node,
    x: initialX,
    y: initialY,
    badgeEl: badge,
    nameEl: name,
    placeEl: place
  };
  applyUserIdentity(entry, user);
  users.set(user.id, entry);
  renderCursor(entry);
  return entry;
}

function removeCursor(id) {
  const entry = users.get(id);
  if (!entry) {
    return;
  }
  entry.node.remove();
  users.delete(id);
}

function renderCursor(entry) {
  entry.node.style.left = `${entry.x}px`;
  entry.node.style.top = `${entry.y}px`;
}

function formatLocation(location) {
  if (!location || location.kind === "unknown") {
    if (location && location.resolved) {
      return "Unknown";
    }
    return "Locating...";
  }
  if (location.kind === "us_state") {
    return `${location.stateCode}, US`;
  }
  if (location.kind === "country") {
    return location.countryName || location.countryCode || "Unknown";
  }
  return "Unknown";
}

function renderBadge(badgeEl, location) {
  badgeEl.replaceChildren();
  if (!location || location.kind === "unknown") {
    badgeEl.textContent = "🌐";
    return;
  }

  if (location.kind === "us_state" && location.flagUrl) {
    const image = document.createElement("img");
    image.src = location.flagUrl;
    image.alt = `${location.stateCode || "US"} flag`;
    image.className = "cursor-flag-image";
    badgeEl.appendChild(image);
    return;
  }

  if (location.kind === "country" && location.countryEmoji) {
    badgeEl.textContent = location.countryEmoji;
    return;
  }

  badgeEl.textContent = "🌐";
}

function applyUserIdentity(entry, user) {
  entry.node.style.background = user.color;
  entry.nameEl.textContent = user.label;
  entry.placeEl.textContent = `· ${formatLocation(user.location)}`;
  renderBadge(entry.badgeEl, user.location);
}

function buildLocationFromGeoResponse(raw) {
  if (!raw || typeof raw !== "object") {
    return { kind: "unknown" };
  }

  const countryCode = String(raw.country_code || raw.country || "").toUpperCase();
  const countryName = String(raw.country_name || raw.country || countryCode || "Unknown");
  const stateCode = String(raw.region_code || "").toUpperCase();
  const stateName = String(raw.region || stateCode || "");

  if (countryCode === "US" && /^[A-Z]{2}$/.test(stateCode)) {
    return {
      kind: "us_state",
      stateCode,
      stateName
    };
  }

  if (/^[A-Z]{2}$/.test(countryCode)) {
    return {
      kind: "country",
      countryCode,
      countryName
    };
  }

  return { kind: "unknown" };
}

async function fetchGeoFrom(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  if (!data || data.error === true || data.success === false) {
    return null;
  }
  return data;
}

async function sendSelfLocation() {
  if (!selfId || locationSent) {
    return;
  }

  try {
    const primary = await fetchGeoFrom("https://ipapi.co/json/");
    const data = primary || (await fetchGeoFrom("https://ipwho.is/"));
    const location = buildLocationFromGeoResponse(data);

    await fetch("/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selfId, location })
    });

    locationSent = true;
  } catch (error) {
    // Non-fatal: server-side location can still resolve when available.
  }
}

function handleEvent(payload) {
  if (payload.type === "self") {
    selfId = payload.user.id;
    ensureCursor(payload.user);
    setStatus(`Connected as ${payload.user.label} (${formatLocation(payload.user.location)})`);
    latestMove = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    queueSendMove();
    void sendSelfLocation();
    return;
  }

  if (payload.type === "snapshot") {
    payload.users.forEach(ensureCursor);
    return;
  }

  if (payload.type === "join") {
    ensureCursor(payload.user);
    return;
  }

  if (payload.type === "leave") {
    removeCursor(payload.id);
    return;
  }

  if (payload.type === "move") {
    const entry = users.get(payload.id);
    if (!entry) {
      return;
    }
    entry.x = payload.x;
    entry.y = payload.y;
    renderCursor(entry);
    return;
  }

  if (payload.type === "user_update") {
    ensureCursor(payload.user);
    if (payload.user.id === selfId) {
      setStatus(`Connected as ${payload.user.label} (${formatLocation(payload.user.location)})`);
    }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function queueSendMove() {
  if (sendTimer || !latestMove || !selfId) {
    return;
  }
  sendTimer = window.setTimeout(async () => {
    sendTimer = null;
    const move = latestMove;
    latestMove = null;
    if (!move) {
      return;
    }
    try {
      await fetch("/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selfId, x: move.x, y: move.y })
      });
    } catch (error) {
      setStatus("Connection unstable. Retrying...");
    }
  }, 16);
}

function onPointerMove(event) {
  if (!selfId) {
    return;
  }

  const bounds = stage.getBoundingClientRect();
  const x = clamp(event.clientX - bounds.left, 0, bounds.width);
  const y = clamp(event.clientY - bounds.top, 0, bounds.height);

  const self = users.get(selfId);
  if (self) {
    self.x = x;
    self.y = y;
    renderCursor(self);
  }

  latestMove = { x, y };
  queueSendMove();
}

function connect() {
  const source = new EventSource("/events");
  source.onmessage = (event) => {
    try {
      handleEvent(JSON.parse(event.data));
    } catch (error) {
      setStatus("Bad server event");
    }
  };

  source.onerror = () => {
    setStatus("Disconnected. Reconnecting...");
  };
}

stage.addEventListener("pointermove", onPointerMove);
connect();
