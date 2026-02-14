# Shared Cursor Localhost Demo

A minimal realtime site where multiple people can see each other's mouse movement.

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
- To change the port:

```bash
PORT=4010 npm start
```

## Files

- `server.js`: HTTP server + SSE realtime broadcast
- `public/index.html`: page structure
- `public/client.js`: cursor sync logic
- `public/styles.css`: styles
