---
name: coolify-deploy
description: Deploy this repo (PERSONA — static nginx site + internal Node /api proxy) to the Coolify server and keep it running. Use when the user asks to deploy, redeploy, ship, push to production, update the live site, check the deployed site, rotate OPENCODE_GO_API_KEY, find the Coolify app uuid, or diagnose a 5xx/health failure on port 8081. Also use when a change to docker-compose.yml, proxy/, or the env contract needs to reach production.
---

# Deploy PERSONA (minichat-translator) to Coolify

Coolify **v4** on the server named by `DEPLOY_COOLIFY_HOST` runs this repo as
**one Docker Compose application**. There is no database, no Redis, no
Medusa/Next.js — just a static site and its proxy:

| Container | Host port | What it is |
| --- | --- | --- |
| `minichat-translator` (nginx:alpine) | **8081** | static PERSONA site, serves the repo tree |
| `minichat-proxy` (node) | internal | `/api/*` → OpenCode Go gateway; injects `OPENCODE_GO_API_KEY` server-side |

The browser only reaches `:8081`. nginx routes `/api/*` to the proxy over the
compose network, so the API key never ships to the client (`config.js` keeps
`apiKey = ''` on purpose).

## Run it

One script, stdlib only, no dependencies:

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py status
```

| Command | What it answers |
| --- | --- |
| `discover` | every Coolify project + application with uuids — how you find the right `APP_UUID` |
| `status` | containers, `GET /` code, `GET /api/chat/completions` probe verdict |
| `app` | this application's Coolify record (uuid, build pack, ports) |
| `deploy` | queue a deployment; `--follow` polls until it finishes. Schedules an image prune (`--no-prune` opts out) |
| `wait` | block until `/` answers 200 **and** `/api` answers the proxy |
| `env` | the application's environment variables (values shown — treat as secret) |
| `set-env KEY VALUE` | create or update one variable, then remind you to redeploy |
| `logs [n]` | tail the most recent deployment log |
| `prune` | remove Docker images no container uses; `--builder` also clears the build cache |
| `tunnel` | ssh `-L` command for the internal proxy, when its port is not published |

## First run: find the application uuid

`DEPLOY_COOLIFY_APP_UUID` / `DEPLOY_COOLIFY_PROJECT_UUID` ship **empty** in
`.coolify.env` (and a uuid copied from another repo would deploy the wrong app).
Run `discover`, then put the matching record in `.coolify.env`:

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py discover
```

Every command that needs the uuid exits with the same hint if it is unset. If
`discover` shows **no application for this repo**, create it first — see the
"create-app" section in [references/traps.md](references/traps.md).

## Credentials

Never hard-code any of these. All come from the repo `.coolify.env`
(mode `0600`, gitignored):

- `DEPLOY_COOLIFY_HOST` — the Coolify server.
- `DEPLOY_COOLIFY_USER` — SSH user (default `root`).
- `DEPLOY_COOLIFY_API_TOKEN` — Coolify personal access token, sent as
  `Authorization: Bearer`.
- `DEPLOY_COOLIFY_PRIVATE_KEY` — the SSH key, materialised by the script to
  `~/.ssh/persona_coolify_deploy` when it is missing. It is multi-line, so
  neither file can be `source`d.
- `DEPLOY_COOLIFY_APP_UUID` / `DEPLOY_COOLIFY_PROJECT_UUID` — this repo's
  Coolify application and project.

`.env` holds **only** `OPENCODE_GO_API_KEY`, which Docker Compose reads
directly — that is why the PEM lives in `.coolify.env` (a multiline value in
`.env` makes `docker compose config` fail). The script loads `.coolify.env`
first and falls back to `.env`, so a checkout that still keeps everything in
one `.env` keeps working.

`OPENCODE_GO_API_KEY` is **not** a deploy credential: it lives in the Coolify
application env (server-side, see
[references/env-vars.md](references/env-vars.md)) and only the proxy container
sees it.

## Verify before calling it done

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py status
```

| Check | Expected |
| --- | --- |
| `GET http://HOST:8081/` | `200` (static PERSONA shell) |
| `GET http://HOST:8081/api/chat/completions` | `200` JSON health route, **or** `405`/`400`/`401` — any answer *from the proxy*. Never `000`, `404`, `502`, `504` |
| `status` container list | both containers `Up` |

A `200 text/html` on the `/api` probe is a trap: nginx served `index.html`
instead of proxying, so `/api` is not routed. The interpretation table lives in
[references/traps.md](references/traps.md).

## Disk hygiene

Every build produces a new timestamped image and Coolify keeps the old ones, so
a handful of deploys fills the host (it has hit "no space left on device"
twice). `deploy` schedules `docker image prune -af` for when the deployment
finishes — `--follow` runs it inline, failures leave images in place so a
rollback has something to roll back to. Output lands in `.deploy-prune.log`.

Run it by hand after a deploy started from the Coolify UI, or when `df -h /`
looks tight:

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py prune
```

Add `--builder` only when the build cache itself is the problem; the next
deploy then rebuilds from scratch, which is slower.

## What lives where

- `docker-compose.yml` — both services: nginx on `8081:80`, proxy with
  `OPENCODE_GO_API_KEY` injected at container start.
- `proxy/proxy.js` — POST-only CORS proxy to `opencode.ai`
  (`/zen/go/v1/chat/completions`); injects the API key from env.
- `proxy/Dockerfile` — `node:22-alpine` for the proxy.
- `docker/nginx.conf` + `docker/Dockerfile` — the baked-image variant of the
  static site (the compose file mounts the repo instead).
- `config.example.js` → `config.js` (gitignored; `apiKey` intentionally empty).

Change any of those and the next `deploy` picks them up; nothing else on the
host needs editing. Full variable list:
**[references/env-vars.md](references/env-vars.md)**.
