# Inkwell deployment

One Node 22 container; SQLite and uploads persist under `/opt/inkwell/data`.
Only the `inkwell` compose project and `/opt/inkwell` belong to this deployment.
Do not change the neighbouring Spaces deployment.

## Update

Commit the desired changes, then run `./deploy/deploy.sh [hostinger-hermes]`.
The script archives **HEAD**, not the working tree, creates the env file only if
missing, builds on the host, waits for health, and checks Spaces before/after.
It does not install or overwrite nginx/TLS configuration on subsequent deploys.
The successful revision is recorded in `/opt/inkwell/deployed-commit`.
Build failure leaves the previous container running. There is no automated
schema/data rollback; never replace the data directory with an older copy.

## First-time edge setup

Install `nginx-inkwell.conf` as the Inkwell-only nginx site and enable it. Run
`nginx -t` **before every reload**. On failure, restore the previous Inkwell
site and stop. Do not modify other sites. Use certbot's nginx plugin to issue
TLS for `inkwell.76-13-246-244.sslip.io`, passing
`--nginx-ctl /opt/inkwell/src/deploy/nginx-checked.sh` to ensure its internal
reloads also run `nginx -t` first. Only add `inkwell.questili.com` to the
certificate once its DNS A record points at `76.13.246.244` (and any AAAA
record resolves correctly). Preserve certbot's resulting site on updates.

## API credentials

Edit `/opt/inkwell/.env` on the host; set `META_API_KEY` privately. Never commit,
print, or copy this file. Then run on the host:

```sh
cd /opt/inkwell/src
docker compose -p inkwell -f deploy/docker-compose.yml up -d --force-recreate --wait
```

A plain restart does not pick up changed env_file values. No API key is required
for notebook/map/editor functionality; AI requests need the owner's key.

## Session and proxy assumptions

Only `GET /api/me` bootstraps an anonymous session. Other cookieless API calls
return JSON 401; health never creates a session. The client already waits for
bootstrap before fetching pages or opening SSE. Multiple explicit cookieless
`/api/me` calls create distinct visitors, not shared sessions: IP + User-Agent
cannot safely identify a person behind a shared network.

New workspaces are limited to 30 per IP per hour in one process. The limit
resets on restart, does not stop distributed abuse, and is not a retention or
disk quota. Expired IP buckets are reclaimed and active buckets are bounded.
Existing session cookies are unaffected by the creation limit.

`TRUST_PROXY=1` trusts a **single** edge proxy: nginx overwrites forwarding
headers, and the application port is bound to host loopback only. Do not expose
that port directly with proxy trust enabled. Cookies are HttpOnly, SameSite=Lax,
last one year and are Secure on HTTPS (including the trusted proxy).

## Verification checklist

- Run `npm run typecheck` and `npx vitest run src/server`.
- Build the Docker image; test `npm start` with a disposable data volume.
- Check health, bootstrap cookie, authenticated map, and production index HTML.
- Check public TLS, SSE streaming, and `/collab` websocket HTTP 101.
- Confirm Spaces health matches the recorded pre-deployment result.
