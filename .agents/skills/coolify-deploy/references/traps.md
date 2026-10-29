# Coolify deploy traps

Everything here cost real debugging time. Read this before the first deploy of
a fresh environment, and re-read it whenever a deploy misbehaves.

## `.coolify.env` has no application uuid (or the wrong one)

`DEPLOY_COOLIFY_APP_UUID` and `DEPLOY_COOLIFY_PROJECT_UUID` are **empty** in
this repo's `.coolify.env`, and a uuid pasted in from another repo (tcg-website,
tcg-inventory, chinese-learning-ecosystem all live on the same Coolify) makes a
deploy build and restart the **wrong application**. Find the right one once:

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py discover
```

The matching record is flagged with `<-- this repo?` (matched on the repo name
in `git_repository`). Paste its uuid and the project uuid into `.coolify.env`.
Every uuid-needing command exits with this same hint while the uuid is unset.

Reading `.coolify.env` at the shell: it **cannot be `source`d**, because
`DEPLOY_COOLIFY_PRIVATE_KEY` is a multi-line PEM. Extract individual keys:

```bash
T=$(grep "^DEPLOY_COOLIFY_API_TOKEN=" .coolify.env | cut -d= -f2-)
```

## create-app: the API cannot create a Docker Compose application

`POST /api/v1/applications` only handles the build packs Coolify can scaffold.
For `build_pack=dockercompose` you have to write the record directly, which
means Tinker inside the Coolify container:

```bash
docker cp /tmp/script.php coolify:/tmp/script.php
docker exec coolify php artisan tinker /tmp/script.php
```

Do **not** use `--execute`. Backslashes in the PHP get mangled before they
reach the interpreter; a file does not.

Before the script: create the project in the Coolify UI (Projects → New), and
make sure a git source + private key exist (Coolify → SSH Keys / Git
providers). Generate a dedicated deploy keypair **on the server**, add the
public key as this repo's deploy key, and register the private key in Coolify —
never commit key material, tokens, or uuids into this repo, the docs, or the
script.

Four things must be right in the Tinker script:

1. **`team_id` is required** on both `PrivateKey` and `Project`. Copy it from an
   existing row — e.g. `PrivateKey::first()->team_id` — or you get
   `SQLSTATE[23502]: null value in column "team_id"`.
2. **The `production` environment is created automatically** by a model event
   when the project is created. An explicit
   `environments()->create(['name'=>'production'])` then collides with
   `environments_name_project_id_unique`. Guard it with a `firstOrCreate`.
3. Point `docker_compose_location` at **`/docker-compose.yml`** (the compose
   file is at this repo's root) and `base_directory` at `/`, not at the compose
   file's directory.
4. The compose file publishes **`8081:80`** (static site) and `3000:3000`
   (proxy). Keep 8081; if 3000 collides with another app on the host, drop the
   proxy's host mapping and reach it through nginx `/api` or `tunnel` instead
   (see the ports table below).

Afterwards run `discover` again and put the new uuids in `.coolify.env`.

## `docker cp` preserves restrictive host permissions

Copying a `0600` private key into the `coolify` container leaves it unreadable
by the container's PHP user, and Tinker fails with
`file_get_contents(...): Permission denied` masked as
`ValidationException: The private key is invalid`. Stage it world-readable
first:

```bash
install -m 644 /tmp/keymat_src /tmp/persona_key_material
docker cp /tmp/persona_key_material coolify:/tmp/
```

The real key stays at its original path, mode 0600. Only the throwaway copy is
loosened — delete it after the script runs.

## A deployment reports "finished" before the app is ready

`status: finished` means the compose project was created, not that the
containers serve traffic. Poll for the real signal:

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py wait
```

which blocks until `GET /` is `200` **and** `/api` answers the proxy.

## Reading the `/api` health probe

`GET http://HOST:8081/api/chat/completions` (the proxy only implements POST,
so a healthy GET is a 405 — that is a pass, not a bug):

| Probe result | Meaning |
| --- | --- |
| `000` | site down, wrong port, or host unreachable |
| `200` + JSON | proxy health route answering |
| `405` / `400` / `401` / `403` / `415` + any body | proxy answering; `405` is the POST-only handler replying to a GET |
| `200` + `text/html` | **nginx served `index.html`** — `/api` is not routed to the proxy (missing `location /api/` or wrong `base_directory`). The site "looks fine" while every chat call fails |
| `404` | nginx has no `/api` route at all — same problem, stock nginx config instead of the custom one |
| `502` / `504` | nginx up, `minichat-proxy` down or unreachable on the compose network |
| other | unexpected — read `logs` |

The app builds its request as `baseUrl + '/chat/completions'`, so whatever
`config.js` sets as `baseUrl` must end up at the proxy (in production: `/api`
served by nginx, or the proxy's own host:port).

## `OPENCODE_GO_API_KEY not set`

`minichat-proxy` answers `500 {"error":"OPENCODE_GO_API_KEY not set"}` when the
env var did not reach the container. Fix with `set-env` (see env-vars.md) and a
`deploy` — a bare container restart is not enough after an env change made
through Coolify's API. The key must never appear in `config.js`
(`apiKey = ''`), a compose file, or a commit.

## Ports on this host

| Port | Owner |
| --- | --- |
| 80, 443, 8080 | Coolify's Traefik proxy |
| 8000 | Coolify dashboard and API |
| 8003 | tcg-website; 80 is tcg-inventory's |
| 3000 | **this repo's proxy (`3000:3000` in `docker-compose.yml`)** — chinese-learning-ecosystem also has `ports_exposes=3000`, so this is the one likely collision. If a deploy dies with "port is already allocated", drop the proxy's host mapping (keep it internal behind nginx `/api`) or move it to a free port |
| **8081** | **PERSONA static site (this app) — `docker-compose.yml` publishes `8081:80`** |

Confirm ownership with `discover` or `docker ps` on the host before claiming a
port — collisions are why a deploy dies with "port is already allocated".

## Disk hygiene

Every deploy leaves a new timestamped image behind and Coolify never deletes
the old ones; the host has run out of space twice. `deploy` schedules
`docker image prune -af` for after the deployment ends (log:
`.deploy-prune.log`). Run `prune` by hand after a UI-started deploy, and
`prune --builder` only when the build cache itself is the problem — the next
deploy then rebuilds from scratch.

## Stale assets after a deploy

`sw.js` registers a service worker that caches **network-first with cache
fallback for GET only** (cache name `persona-v3`). When the network fetch
fails, the browser keeps showing the previous bundle, so a broken deploy can
look healthy in an open tab. Verify with `curl` or a fresh browser profile, and
bump the cache name in `sw.js` when shipping breaking asset changes.
