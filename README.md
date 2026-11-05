# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and a
morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

## Export a digest preview

Run the real local service in one terminal. It binds to `127.0.0.1` only. To include the current
lane banner, use the configured marker:

```sh
PORT=8787 pnpm start
```

In another terminal, save the page as one HTML file outside the repository:

```sh
curl --fail --show-error --silent http://127.0.0.1:8787/digest/2026-10-28 \
  --output /tmp/rig-digest-2026-10-28.html
```

For the clean copy, stop the service and restart it with `LANE_MARKER` explicitly empty. The empty
process environment value takes precedence over `.env`, so the exported banner says `no marker set`:

```sh
LANE_MARKER= PORT=8787 pnpm start
```

Run the same `curl` command again to replace the file. Keep the exported HTML outside the repository.

Working on it with an agent: start at [AGENTS.md](AGENTS.md).
