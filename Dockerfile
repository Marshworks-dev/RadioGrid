FROM node:24-alpine
WORKDIR /app
COPY server.js ./
# PWA static assets (the HTML is volume-mounted at runtime; these are baked in).
COPY manifest.json sw.js icon.svg icon-192.png icon-512.png ./
# Run unprivileged. The official node image ships a "node" user (uid 1000).
# Files stay root-owned 0644 — world-readable, not writable by the app, which
# is all a read-only static server needs. Port 3900 is >1024, no caps needed.
USER node
EXPOSE 3900
CMD ["node", "server.js"]
