# Shared Cursor Demo

A minimal realtime site where multiple people can see each other's mouse movement.

## Live Deployment

Hosted on Render:
- `https://multiplayer-mouses.onrender.com`

## Run

```bash
npm start
```

Default host/port:
- Host: `0.0.0.0`
- Port: `4000` (not `3000` or `3001`)

Open:
- On your machine: `http://localhost:4000`
- On another computer on same Wi-Fi: `http://<your-lan-ip>:4000`

## Notes

- If your firewall blocks inbound traffic on `4000`, allow it.
- Render free instances can be slow on first request after idle time (cold start).
- To change the port:

```bash
PORT=4010 npm start
```

## Files

- `server.js`: HTTP server + SSE realtime broadcast
- `public/index.html`: page structure
- `public/client.js`: cursor sync logic
- `public/styles.css`: styles
