const statusEl = document.getElementById("status");
const stage = document.getElementById("stage");

const users = new Map();
let selfId = null;
let latestMove = null;
let sendTimer = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function ensureCursor(user) {
  let entry = users.get(user.id);
  if (entry) {
    return entry;
  }

  const node = document.createElement("div");
  node.className = "cursor";
  node.style.background = user.color;

  const label = document.createElement("span");
  label.className = "cursor-label";
  label.textContent = user.label;
  node.appendChild(label);
  stage.appendChild(node);

  const initialX = typeof user.x === "number" ? user.x : stage.clientWidth / 2;
  const initialY = typeof user.y === "number" ? user.y : stage.clientHeight / 2;
  entry = { ...user, node, x: initialX, y: initialY };
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

function handleEvent(payload) {
  if (payload.type === "self") {
    selfId = payload.user.id;
    ensureCursor(payload.user);
    setStatus(`Connected as ${payload.user.label}`);
    latestMove = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    queueSendMove();
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
