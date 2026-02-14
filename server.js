const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const GEO_ENABLED = process.env.DISABLE_GEO !== "1";
const GEO_API_BASE = process.env.GEO_API_BASE || "https://ipapi.co";
const GEO_TIMEOUT_MS = Number(process.env.GEO_TIMEOUT_MS) || 1500;
const GEO_CACHE_TTL_MS = Number(process.env.GEO_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;

const publicDir = path.join(__dirname, "public");
const clients = new Set();
const users = new Map();
const locationCache = new Map();
const US_REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP"
]);

function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload, exclude) {
  for (const client of clients) {
    if (client !== exclude) {
      sendSSE(client, payload);
    }
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return normalizeIp(forwarded.split(",")[0].trim());
  }
  return normalizeIp(req.socket.remoteAddress || "unknown");
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function makeColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 55%)`;
}

function unknownLocation() {
  return {
    kind: "unknown",
    label: "Unknown"
  };
}

function normalizeIp(value) {
  if (!value) {
    return "unknown";
  }
  let ip = String(value).trim();
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  if (ip === "::1") {
    return "127.0.0.1";
  }
  if (ip.startsWith("[") && ip.endsWith("]")) {
    ip = ip.slice(1, -1);
  }
  return ip;
}

function isPrivateOrLocalIp(ip) {
  if (!ip || ip === "unknown") {
    return true;
  }

  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    );
  }

  if (ip.startsWith("127.")) {
    return true;
  }
  if (ip.startsWith("10.")) {
    return true;
  }
  if (ip.startsWith("192.168.")) {
    return true;
  }
  if (ip.startsWith("172.")) {
    const parts = ip.split(".");
    const second = Number(parts[1]);
    if (!Number.isNaN(second) && second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

function countryCodeToEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return "";
  }
  const code = countryCode.toUpperCase();
  const first = code.codePointAt(0);
  const second = code.codePointAt(1);
  if (!first || !second) {
    return "";
  }
  return String.fromCodePoint(127397 + first, 127397 + second);
}

function parseLocationData(data) {
  if (!data || typeof data !== "object") {
    return unknownLocation();
  }
  const countryCode = String(data.country_code || data.country || "").toUpperCase();
  const countryName = String(data.country_name || countryCode || "Unknown");
  const regionCode = String(data.region_code || "").toUpperCase();
  const regionName = String(data.region || regionCode || "");

  if (countryCode === "US" && US_REGION_CODES.has(regionCode)) {
    return {
      kind: "us_state",
      countryCode: "US",
      stateCode: regionCode,
      stateName: regionName,
      label: `${regionCode}, US`,
      flagUrl: `https://cdn.jsdelivr.net/npm/us-state-flags@1.0.7/assets/flags/svg/${regionCode}.svg`
    };
  }

  if (countryCode.length === 2) {
    return {
      kind: "country",
      countryCode,
      countryName,
      label: countryName,
      countryEmoji: countryCodeToEmoji(countryCode)
    };
  }

  return unknownLocation();
}

async function fetchLocationData(ip) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const ipPath = encodeURIComponent(ip);
    const response = await fetch(`${GEO_API_BASE.replace(/\/$/, "")}/${ipPath}/json/`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (data && data.error) {
      return null;
    }
    return data;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getLocationForIp(ip) {
  if (!GEO_ENABLED || isPrivateOrLocalIp(ip)) {
    return unknownLocation();
  }

  const cached = locationCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const remoteData = await fetchLocationData(ip);
  const location = parseLocationData(remoteData);
  locationCache.set(ip, { value: location, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  return location;
}

async function hydrateUserLocation(userId, ip) {
  const current = users.get(userId);
  if (!current) {
    return;
  }
  const location = await getLocationForIp(ip);
  const liveUser = users.get(userId);
  if (!liveUser) {
    return;
  }
  liveUser.location = location;
  broadcast({ type: "user_update", user: liveUser });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    serveFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/client.js") {
    serveFile(res, path.join(publicDir, "client.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/styles.css") {
    serveFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const id = randomUUID();
    const ip = getClientIp(req);
    const user = {
      id,
      label: `User ${users.size + 1}`,
      color: makeColor(`${id}-${ip}`),
      location: unknownLocation()
    };

    users.set(id, user);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write("retry: 500\n\n");
    clients.add(res);

    sendSSE(res, { type: "self", user });
    sendSSE(res, { type: "snapshot", users: Array.from(users.values()) });
    broadcast({ type: "join", user }, res);
    void hydrateUserLocation(id, ip);

    req.on("close", () => {
      clients.delete(res);
      users.delete(id);
      broadcast({ type: "leave", id });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/move") {
    try {
      const body = await parseBody(req);
      const { id, x, y } = body;
      if (!id || typeof x !== "number" || typeof y !== "number" || !users.has(id)) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Invalid payload" }));
        return;
      }

      const user = users.get(id);
      user.x = x;
      user.y = y;
      broadcast({ type: "move", id, x, y });
      res.writeHead(204);
      res.end();
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Bad JSON body" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
