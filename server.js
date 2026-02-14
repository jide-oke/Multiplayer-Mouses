const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "0.0.0.0";

const publicDir = path.join(__dirname, "public");
const clients = new Set();
const users = new Map();

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
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
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
      color: makeColor(`${id}-${ip}`)
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
