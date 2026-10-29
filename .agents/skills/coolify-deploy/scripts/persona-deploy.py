#!/usr/bin/env python3
"""Deploy PERSONA (minichat-translator) to the Coolify server.

Stdlib only — no pip install, no venv, no docker on this machine. Everything
runs over the Coolify REST API and SSH to the host. Credentials come from the
repo `.coolify.env` (0600, gitignored; `.env` is read as a legacy fallback so
an old single-file checkout keeps working); nothing is hard-coded and no secret
is printed unless you ask for it explicitly (``env``).

Usage:
    python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py discover
    python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py status
    python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py deploy --follow
    python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py set-env KEY VALUE

Read ../references/traps.md before the first deploy. In particular, if
DEPLOY_COOLIFY_APP_UUID is empty in .coolify.env, run ``discover`` first and
put the matching application uuid there.

Renamed from tcg-deploy.py (the TCG-website version of this skill); the old
name no longer exists.

Health contract: GET http://HOST:8081/ must return 200, and
GET http://HOST:8081/api/chat/completions must return an answer from the
internal Node proxy (200 JSON health route, or 405 for a GET on the
POST-only handler) — never 000/502/504.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# scripts/ -> coolify-deploy/ -> skills/ -> .agents/ -> repo root
REPO = Path(__file__).resolve().parents[4]
COOLIFY_ENV_FILE = REPO / ".coolify.env"  # deploy credentials (0600, gitignored)
LEGACY_ENV_FILE = REPO / ".env"  # legacy fallback + OPENCODE_GO_API_KEY
KEY_PATH = Path.home() / ".ssh" / "persona_coolify_deploy"


# --------------------------------------------------------------------------
# .coolify.env (primary) / .env (legacy fallback)
# --------------------------------------------------------------------------

def parse_env_file(path: Path, env: dict[str, str]) -> None:
    """Merge one KEY=VALUE file into ``env``, including a multi-line PEM block.

    Neither file can be ``source``d in a shell because DEPLOY_COOLIFY_PRIVATE_KEY
    is a multi-line PEM, so they are parsed here instead.
    """
    key: str | None = None
    chunks: list[str] = []
    for raw in path.read_text().splitlines():
        if key is not None:
            if raw.startswith("-----END") or raw.rstrip().endswith("-----"):
                chunks.append(raw.strip())
                env[key] = "\n".join(chunks)
                key, chunks = None, []
            else:
                chunks.append(raw.rstrip())
            continue
        if not raw.strip() or raw.lstrip().startswith("#") or "=" not in raw:
            continue
        name, _, value = raw.partition("=")
        name, value = name.strip(), value.strip()
        if value.startswith("-----BEGIN"):
            key, chunks = name, [value]
            continue
        env[name] = value.strip('"').strip("'")


def load_env() -> dict[str, str]:
    """Merge ``.coolify.env`` (primary) over ``.env`` (legacy fallback).

    Deploy credentials moved out of ``.env`` into ``.coolify.env`` so that
    ``docker compose`` — which reads ``.env`` itself — never sees the
    multi-line PEM. ``.env`` is still parsed first for compatibility with
    checkouts that predate the split; ``.coolify.env`` wins on any key that
    appears in both.
    """
    files = [p for p in (LEGACY_ENV_FILE, COOLIFY_ENV_FILE) if p.exists()]
    if not files:
        sys.exit(f"{COOLIFY_ENV_FILE} is missing (legacy fallback: {LEGACY_ENV_FILE}).")
    env: dict[str, str] = {}
    for path in files:
        parse_env_file(path, env)
    return env


def env_hint() -> str:
    """The file that should hold deploy credentials right now."""
    return COOLIFY_ENV_FILE.name if COOLIFY_ENV_FILE.exists() else LEGACY_ENV_FILE.name


ENV = load_env()


def require(name: str) -> str:
    value = ENV.get(name, "")
    if not value:
        sys.exit(f"{name} is not set in {env_hint()}.")
    return value


HOST = ENV.get("DEPLOY_COOLIFY_HOST", "")
SSH_USER = ENV.get("DEPLOY_COOLIFY_USER", "root")
API = ENV.get("DEPLOY_COOLIFY_API_URL") or (f"http://{HOST}:8000/api/v1" if HOST else "")
SITE = ENV.get("DEPLOY_COOLIFY_SITE_URL") or (f"http://{HOST}:8081" if HOST else "")
PROXY_PORT = ENV.get("DEPLOY_COOLIFY_PROXY_PORT", "3000")
SSH_OPTS = ["-i", str(KEY_PATH), "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=10", "-o", "BatchMode=yes"]


def ensure_key() -> Path:
    """Materialise the deploy private key on disk when it is missing."""
    if KEY_PATH.exists():
        return KEY_PATH
    material = ENV.get("DEPLOY_COOLIFY_PRIVATE_KEY", "")
    if not material:
        sys.exit(f"DEPLOY_COOLIFY_PRIVATE_KEY is not set in {env_hint()}.")
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    KEY_PATH.write_text(material if material.endswith("\n") else material + "\n")
    KEY_PATH.chmod(0o600)
    return KEY_PATH


# --------------------------------------------------------------------------
# transports
# --------------------------------------------------------------------------

def api(path: str, method: str = "GET", body: dict | None = None):
    """Call the Coolify REST API."""
    if not API:
        sys.exit(f"DEPLOY_COOLIFY_HOST is not set in {env_hint()}.")
    token = require("DEPLOY_COOLIFY_API_TOKEN")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:400]
        sys.exit(f"Coolify API {method} {path} -> HTTP {exc.code}\n{detail}")


def ssh(command: str, timeout: int = 180) -> str:
    """Run one command on the Coolify host."""
    ensure_key()
    proc = subprocess.run(
        ["ssh", *SSH_OPTS, f"{SSH_USER}@{HOST}", command],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        sys.exit(f"ssh failed ({proc.returncode}): {proc.stderr.strip()[:400]}")
    return proc.stdout


def app_uuid() -> str:
    return ENV.get("DEPLOY_COOLIFY_APP_UUID", "")


def need_app() -> str:
    uuid = app_uuid()
    if not uuid:
        sys.exit(
            f"DEPLOY_COOLIFY_APP_UUID is not set in {env_hint()}.\n"
            "Run:  python3 .agents/skills/coolify-deploy/scripts/persona-deploy.py discover\n"
            f"then put the matching application uuid in {env_hint()}."
        )
    return uuid


# --------------------------------------------------------------------------
# health probes
# --------------------------------------------------------------------------

def http_probe(url: str) -> tuple[str, str]:
    """GET a URL, return (status_code, content_type). 000 = no response."""
    try:
        out = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-L", "--max-time", "45",
             "-w", "%{http_code}\t%{content_type}", url],
            capture_output=True, text=True, timeout=60,
        ).stdout.strip()
        code, _, ctype = out.partition("\t")
        return (code or "000"), ctype
    except Exception:
        return "000", ""


def site_code(path: str) -> str:
    if not SITE:
        sys.exit(f"DEPLOY_COOLIFY_HOST is not set in {env_hint()}.")
    return http_probe(SITE + path)[0]


def api_probe() -> tuple[str, str]:
    """GET /api/chat/completions through nginx to the internal proxy.

    The proxy only implements POST, so a healthy GET answers 405; a proxy
    with a health route answers 200 JSON. Both mean "the proxy is reachable".
    """
    if not SITE:
        sys.exit(f"DEPLOY_COOLIFY_HOST is not set in {env_hint()}.")
    return http_probe(SITE + "/api/chat/completions")


def api_verdict(code: str, ctype: str) -> tuple[bool, str]:
    """(ready, message) for an /api probe result."""
    if code == "000":
        return False, "FAIL — no response from the site"
    if code in {"502", "504"}:
        return False, "FAIL — nginx up but the proxy is unreachable"
    if code == "404":
        return False, "FAIL — nginx has no /api route to the proxy (custom nginx config missing?)"
    if code == "200" and "json" in ctype.lower():
        return True, "OK — proxy health route"
    if code in {"400", "401", "403", "405", "415"}:
        return True, f"OK — proxy answering (HTTP {code}; 405 is expected for a GET on the POST-only route)"
    if code == "200":
        return True, "WARN — 200 but not JSON: nginx served index.html, /api is probably not routed to the proxy"
    return False, f"FAIL — unexpected HTTP {code} from /api"


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def containers() -> list[dict]:
    """Containers of this application (matched by uuid, else by service name)."""
    needle = app_uuid() or "minichat"
    # `|| true`: a grep miss must not fail the pipeline (exit 1 → ssh non-zero).
    out = ssh(
        "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}' "
        f"| grep {needle} || true"
    )
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            rows.append({"name": parts[0], "status": parts[1],
                         "ports": parts[2] if len(parts) > 2 else ""})
    return rows


def cmd_status(_args) -> None:
    print(f"host      {HOST}")
    print(f"app       {app_uuid() or '(not set — run discover)'}")
    print(f"site      {SITE}")
    print()
    rows = containers()
    if not rows:
        print("no containers found for this application")
    for row in rows:
        print(f"{row['name']:<70} {row['status']}")
        if row["ports"]:
            print(f"{'':<70} {row['ports']}")
    print()
    root = site_code("/")
    print(f"/                          {root}   (expected 200)")
    code, ctype = api_probe()
    ready, message = api_verdict(code, ctype)
    print(f"/api/chat/completions      {code} {ctype}   {message}")


def cmd_app(_args) -> None:
    record = api(f"/applications/{need_app()}")
    for field in ("uuid", "name", "git_repository", "git_branch",
                  "build_pack", "docker_compose_location", "base_directory",
                  "ports_exposes", "fqdn", "status"):
        print(f"{field:<24} {record.get(field)}")


def cmd_discover(_args) -> None:
    """List Coolify projects and applications so the uuid can be found."""
    apps = api("/applications")
    if isinstance(apps, dict):
        apps = apps.get("applications", [])
    projects = api("/projects")
    if isinstance(projects, dict):
        projects = projects.get("projects", [])
    if not projects:
        print("(no projects returned — check the API token's team/scope)")
    print("== projects ==")
    for p in projects or []:
        print(f"{p.get('uuid')}  {p.get('name')}")

    marker = REPO.name  # minichat-translator
    print()
    print("== applications ==")
    matches = 0
    for a in apps or []:
        # The list payload carries only environment_id; the project uuid lives
        # on the detail record under environment -> project.
        detail = api(f"/applications/{a.get('uuid')}") or {}
        environment = detail.get("environment") or {}
        project = environment.get("project") or {}
        project_uuid = project.get("uuid") or "(unknown)"
        project_name = project.get("name") or ""
        repo_url = str(detail.get("git_repository") or "")
        name = str(detail.get("name") or "")
        hint = ""
        if marker in repo_url or "persona" in name.lower() or marker in name.lower():
            hint = "   <-- this repo?"
            matches += 1
        print(f"{detail.get('uuid')}  {name}")
        print(f"    build_pack={detail.get('build_pack')}  "
              f"project={project_uuid} ({project_name})  "
              f"repo={repo_url}@{detail.get('git_branch')}  "
              f"ports={detail.get('ports_exposes')}{hint}")
    print()
    print(f"Put the matching record in {env_hint()}:")
    print("  DEPLOY_COOLIFY_APP_UUID=<application uuid>")
    print("  DEPLOY_COOLIFY_PROJECT_UUID=<project uuid>")
    if not matches:
        print()
        print("No application matches this repo yet — create it first "
              "(see references/traps.md, \"create-app\").")


def cmd_deploy(args) -> None:
    uuid = need_app()
    result = api(f"/deploy?uuid={uuid}&force={str(bool(args.force)).lower()}", "POST")
    deployments = (result or {}).get("deployments", [])
    if not deployments:
        print(json.dumps(result, indent=2)[:800])
        return
    for item in deployments:
        print(item.get("message", ""))
        print(f"deployment_uuid={item.get('deployment_uuid')}")

    dep_uuid = deployments[0].get("deployment_uuid")
    if not dep_uuid:
        return

    if args.follow:
        status = wait_for_deployment(dep_uuid)
        if status == 0:
            run_prune()
        else:
            # A failed deploy may still be about to be rolled back; keep the
            # old image so there is something to roll back to.
            print("deployment did not finish cleanly — images left in place")
        sys.exit(status)

    if args.no_prune:
        print("skipped the post-deploy image prune (--no-prune)")
        return

    log = spawn_pruner(dep_uuid)
    print(f"image prune scheduled for when {dep_uuid} finishes (log: {log})")


def wait_for_deployment(uuid: str, poll: int = 20, limit: int = 90) -> int:
    for attempt in range(1, limit + 1):
        record = api(f"/deployments/{uuid}")
        status = (record or {}).get("status", "?")
        print(f"  [{attempt * poll:>3}s] {status}")
        if status in {"finished", "failed", "error", "cancelled"}:
            if status != "finished":
                print("\n-- last 40 log lines --")
                print(render_logs(record, 40))
            return 0 if status == "finished" else 1
        time.sleep(poll)
    print("timed out waiting for the deployment")
    return 1


def cmd_wait(_args) -> None:
    """Block until the site and the /api proxy both answer.

    ``status: finished`` only means the compose project was created, not that
    the containers serve traffic.
    """
    for attempt in range(1, 81):
        root = site_code("/")
        code, ctype = api_probe()
        ready, message = api_verdict(code, ctype)
        print(f"  [{attempt * 10:>3}s] / {root}  /api {code}  {message}")
        if root == "200" and ready:
            print("site ready")
            return
        time.sleep(10)
    sys.exit("site never became healthy — see references/traps.md")


def run_prune(include_builder: bool = False, quiet: bool = False) -> None:
    """Drop Docker images that no container references.

    Coolify tags every build with a timestamp and never deletes the previous
    one, so the host fills up after a handful of deploys. ``docker image
    prune -af`` only removes images no container — running or stopped — still
    points at, so live containers are untouched. The build cache is left alone
    unless ``include_builder`` is set, because clearing it turns the next
    deploy into a full rebuild.
    """
    commands = ["docker image prune -af"]
    if include_builder:
        commands.append("docker builder prune -af")
    for command in commands:
        out = ssh(command, timeout=900).strip()
        if not quiet:
            print(f"$ {command}")
            print(out or "(nothing to remove)")
    disk = ssh("df -h / | tail -1").strip()
    if not quiet:
        print(f"disk after prune: {disk}")


def wait_for_deploy_quietly(uuid: str, poll: int = 20, limit: int = 120) -> bool:
    """Wait for a deployment without printing progress (used by the pruner)."""
    terminal = {"finished", "failed", "error", "cancelled"}
    for _ in range(limit):
        record = api(f"/deployments/{uuid}") or {}
        if record.get("status") in terminal:
            return record.get("status") == "finished"
        time.sleep(poll)
    return False


def spawn_pruner(deployment_uuid: str, include_builder: bool = False) -> Path:
    """Start the pruner detached so ``deploy`` still returns immediately.

    It waits for the deployment to finish (up to 40 minutes) before pruning,
    because until the new containers are up the old image is still in use.
    """
    log = REPO / ".deploy-prune.log"
    with log.open("a") as handle:
        handle.write(f"\n--- prune after {deployment_uuid} ---\n")
        handle.flush()
        command = [sys.executable, str(Path(__file__).resolve()),
                   "prune", "--after-deploy", deployment_uuid]
        if include_builder:
            command.append("--builder")
        subprocess.Popen(command, stdout=handle, stderr=subprocess.STDOUT,
                         start_new_session=True, cwd=str(REPO))
    return log


def cmd_prune(args) -> None:
    if args.after_deploy:
        if not wait_for_deploy_quietly(args.after_deploy):
            print(f"{args.after_deploy} did not finish; images left in place")
            return
        # The old containers are removed a moment after the new ones report up.
        time.sleep(20)
    run_prune(include_builder=args.builder)


def cmd_env(_args) -> None:
    for item in api(f"/applications/{need_app()}/envs") or []:
        print(f"{item.get('key')}={item.get('value')}")


def cmd_set_env(args) -> None:
    body = {"key": args.key, "value": args.value, "is_preview": False}
    try:
        api(f"/applications/{need_app()}/envs", "POST", body)
        print(f"created {args.key}")
    except SystemExit:
        # Already present — PATCH on the same path updates it.
        api(f"/applications/{need_app()}/envs", "PATCH", body)
        print(f"updated {args.key}")
    print("redeploy for it to reach the containers")


def latest_deployment() -> dict | None:
    """The newest deployment for this application.

    Coolify has returned this as a bare list and as a dict with a
    ``deployments`` key across versions, so both are accepted. The path is
    ``/deployments/applications/{uuid}`` — ``/deployments/{uuid}`` expects a
    *deployment* uuid and answers with a bare ``{"message": ...}``.
    """
    payload = api(f"/deployments/applications/{need_app()}")
    if isinstance(payload, list):
        return payload[0] if payload else None
    if isinstance(payload, dict):
        entries = payload.get("deployments") or []
        return entries[0] if entries else None
    return None


def render_logs(record: object, limit: int = 40) -> str:
    """Turn Coolify's JSON log blob into readable lines.

    ``logs`` arrives as a *string* of concatenated JSON objects
    (``{"command":…,"output":"…","type":"…"}``), not as a list of dicts.
    Each ``output`` is a JSON string body, so it is unescaped with
    ``json.loads`` rather than ``unicode_escape`` — the latter warns on the
    ``\\/`` that JSON emits for forward slashes.
    """
    raw = record.get("logs") if isinstance(record, dict) else None
    if not isinstance(raw, str) or not raw.strip():
        return json.dumps(raw)[:2000] if raw is not None else "(no logs)"
    lines: list[str] = []
    for match in re.finditer(r'"output":\s*"((?:[^"\\]|\\.)*)"', raw):
        try:
            text = json.loads(f'"{match.group(1)}"')
        except json.JSONDecodeError:
            text = match.group(1)
        if text.strip():
            lines.append(text.rstrip())
    return "\n".join(lines[-limit:]) if lines else raw[-2000:]


def cmd_logs(args) -> None:
    record = latest_deployment()
    if not record:
        print("no deployments recorded for this application")
        return
    print(f"deployment {record.get('deployment_uuid')}  status={record.get('status')}")
    print(render_logs(record, args.lines))


def cmd_tunnel(_args) -> None:
    """Print the SSH tunnel to the proxy when its port is not published."""
    ensure_key()
    print(f"ssh -i {KEY_PATH} -L {PROXY_PORT}:127.0.0.1:{PROXY_PORT} {SSH_USER}@{HOST}")
    print(f"then POST http://127.0.0.1:{PROXY_PORT}/chat/completions (the proxy "
          "accepts any path, method POST)")


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("discover", help="list Coolify projects and applications (find the uuid)")
    sub.add_parser("status", help="containers, site code, /api proxy probe")
    sub.add_parser("app", help="the Coolify application record")

    p = sub.add_parser("deploy", help="queue a deployment")
    p.add_argument("--follow", action="store_true", help="poll until it finishes")
    p.add_argument("--force", action="store_true", help="force a rebuild")
    p.add_argument("--no-prune", action="store_true",
                   help="keep the previous images (no post-deploy prune)")

    sub.add_parser("wait", help="block until / returns 200 and /api answers")
    sub.add_parser("env", help="list environment variables (values included — secret)")

    p = sub.add_parser("set-env", help="create or update one variable")
    p.add_argument("key")
    p.add_argument("value")

    p = sub.add_parser("logs", help="tail the most recent deployment log")
    p.add_argument("lines", nargs="?", type=int, default=40)

    sub.add_parser("tunnel", help="print the SSH tunnel command for the internal proxy")

    p = sub.add_parser("prune", help="remove Docker images no container uses")
    p.add_argument("--builder", action="store_true",
                   help="also clear the build cache (next deploy is a full rebuild)")
    p.add_argument("--after-deploy", metavar="UUID", help=argparse.SUPPRESS)

    args = parser.parse_args()
    {
        "discover": cmd_discover,
        "status": cmd_status,
        "app": cmd_app,
        "deploy": cmd_deploy,
        "wait": cmd_wait,
        "env": cmd_env,
        "set-env": cmd_set_env,
        "logs": cmd_logs,
        "tunnel": cmd_tunnel,
        "prune": cmd_prune,
    }[args.command](args)


if __name__ == "__main__":
    main()
