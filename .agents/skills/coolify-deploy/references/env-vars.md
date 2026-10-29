# Environment variables

There are **three separate places** variables live. Do not mix them: deploy
credentials never go to Coolify, runtime keys never go into the repo.

## 1. Repo `.coolify.env` — deploy credentials (local, 0600, gitignored)

Parsed by `scripts/persona-deploy.py` (stdlib parser — neither file can be
`source`d because one value is multi-line). Never sent to Coolify.

| Key | What it is |
| --- | --- |
| `DEPLOY_COOLIFY_HOST` | the Coolify server address |
| `DEPLOY_COOLIFY_USER` | SSH user, default `root` |
| `DEPLOY_COOLIFY_API_TOKEN` | Coolify personal access token (`Authorization: Bearer`) |
| `DEPLOY_COOLIFY_PRIVATE_KEY` | multi-line OpenSSH PEM; materialised to `~/.ssh/persona_coolify_deploy` (0600) when missing |
| `DEPLOY_COOLIFY_APP_UUID` | this application — empty until `discover` fills it in |
| `DEPLOY_COOLIFY_PROJECT_UUID` | this project — same |

Optional overrides (rarely needed):

| Key | Default |
| --- | --- |
| `DEPLOY_COOLIFY_API_URL` | `http://$DEPLOY_COOLIFY_HOST:8000/api/v1` |
| `DEPLOY_COOLIFY_SITE_URL` | `http://$DEPLOY_COOLIFY_HOST:8081` |
| `DEPLOY_COOLIFY_PROXY_PORT` | `3000` (used by `tunnel`) |

Extract one key at the shell instead of sourcing:

```bash
T=$(grep "^DEPLOY_COOLIFY_API_TOKEN=" .coolify.env | cut -d= -f2-)
```

### Repo `.env` — one key, read by Docker Compose

`.env` deliberately holds **only** `OPENCODE_GO_API_KEY`, the value used for a
**local** `docker compose up`. Docker Compose reads `.env` itself, and a
multi-line PEM in it makes `docker compose config` fail — that is the whole
reason the deploy credentials moved to `.coolify.env`. Both files are
gitignored (`.coolify.env` explicitly, mode `0600`).

The deploy script loads `.coolify.env` first and falls back to `.env`, so an
older checkout that still carries `DEPLOY_COOLIFY_*` in `.env` keeps working.

## 2. Coolify application env — runtime (server-side)

Set on the application (`set-env` → `POST /api/v1/applications/{uuid}/envs`).
Coolify injects them into `docker-compose.yml` at deploy time; there is no
`.env` file beside the compose file on the host.

| Key | Required | Notes |
| --- | --- | --- |
| `OPENCODE_GO_API_KEY` | **yes** | The only secret the app needs. Injected into `minichat-proxy` only; used server-side as `Authorization: Bearer` toward the OpenCode Go gateway. Never reaches the browser (`config.js` keeps `apiKey = ''`). Missing → proxy answers `500 {"error":"OPENCODE_GO_API_KEY not set"}` |
| `TZ` | no | Container timezone (compose default `America/New_York`) |

There is **no database, no Redis, no Medusa/Next.js** in this deployment — no
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, CORS, or publishable-key variables
exist here. Anything else showing up in `env` is a leftover from another app's
pattern; remove it.

Values printed by `env` are live secrets. Do not paste them into commits,
issues, chat, or screenshots.

### Setting or rotating a variable

```bash
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py set-env OPENCODE_GO_API_KEY <new value>
python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py deploy --follow
```

`set-env` is `POST` to create, `PATCH` on the **same** path to update — a bulk
`PATCH /env` (singular) is a 404, the endpoint does not exist, so variables go
one at a time. A variable changed through the API reaches the containers only
on the **next deploy** (a restart alone is not enough). Nothing here is
build-time: the static site has no build args.

### Health contract after any change

- `GET http://HOST:8081/` → `200`
- `GET http://HOST:8081/api/chat/completions` → proxy answers (`200` JSON
  health route, or `405` for a GET on the POST-only handler)

`persona-deploy.py status` prints both probes and interprets them; the full
interpretation table is in [traps.md](traps.md).
