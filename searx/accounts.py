# SPDX-License-Identifier: AGPL-3.0-or-later
"""The Alexandria account: sign in with Pocket ID (OpenID Connect), sync the start page.

Pocket ID is the identity provider for all the self-hosted apps, so signing in
here also signs you in "everywhere" (Nextcloud, BookStack, Forgejo, ... log in
through the same Pocket ID session), the way a Google account works.

Turned on by three environment variables (the stack in Portainer):

- ``ALEXANDRIA_OIDC_ISSUER``         e.g. ``https://id.jack-sally.com``
- ``ALEXANDRIA_OIDC_CLIENT_ID``      the OIDC client made for Alexandria in Pocket ID
- ``ALEXANDRIA_OIDC_CLIENT_SECRET``  its secret

Without them there is no sign-in button and nothing else changes.

Routes:

- ``/account/login``     -> Pocket ID (authorization code + PKCE)
- ``/account/callback``  <- back from Pocket ID; the profile goes into the signed session cookie
- ``/account/logout``    -> clears the session and ends the Pocket ID session too
- ``/account/data``      GET / PUT the synced start page state (shortcuts, recent searches,
                         weather city, widget switches) as one small JSON object per account

The synced state is stored in SQLite next to SearXNG's cache (the persistent
``alexandria-data`` volume), keyed by the account's OIDC ``sub``.
"""

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import tempfile
import threading
import time
import typing as t
import urllib.request
from urllib.parse import urlencode

import flask
from flask.json import jsonify

from searx import get_setting, logger

log = logger.getChild("accounts")

SYNC_KEYS = ("sxng-home-prefs", "sxng-home-history", "sxng-home-shortcuts", "sxng-home-place")
SYNC_MAX_BYTES = 64 * 1024
SESSION_DAYS = 30
_DISCOVERY_TTL = 3600
_discovery: tuple[float, dict[str, t.Any]] | None = None
_db_lock = threading.Lock()


def _fetch_json(url: str, form: dict[str, str] | None = None, token: str = "") -> dict[str, t.Any]:
    # Pocket ID is our own server (often on the LAN): talk to it directly, not through the
    # engines' outgoing network (proxies, http disabled, ...)
    body = urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=body, headers={"Accept": "application/json"})
    if body is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=8) as resp:  # nosec B310: issuer URL comes from our own config
        return json.loads(resp.read().decode())


def _config() -> dict[str, str] | None:
    issuer = os.environ.get("ALEXANDRIA_OIDC_ISSUER", "").strip().rstrip("/")
    client_id = os.environ.get("ALEXANDRIA_OIDC_CLIENT_ID", "").strip()
    secret = os.environ.get("ALEXANDRIA_OIDC_CLIENT_SECRET", "").strip()
    if not (issuer and client_id and secret):
        return None
    return {"issuer": issuer, "client_id": client_id, "secret": secret}


def enabled() -> bool:
    return _config() is not None


def _metadata() -> dict[str, t.Any]:
    global _discovery  # pylint: disable=global-statement
    cfg = _config()
    assert cfg
    if _discovery and time.time() - _discovery[0] < _DISCOVERY_TTL:
        return _discovery[1]
    meta = _fetch_json(cfg["issuer"] + "/.well-known/openid-configuration")
    _discovery = (time.time(), meta)
    return meta


def _base_url() -> str:
    base = get_setting("server.base_url") or flask.request.url_root
    return str(base).rstrip("/") + "/"


def _callback_url() -> str:
    return _base_url() + "account/callback"


def _safe_next(target: str | None) -> str:
    # only same-site paths, never an open redirect
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return "/"


def current() -> dict[str, str] | None:
    account = flask.session.get("account")
    return account if isinstance(account, dict) else None


# ----------------------------------------------------------------------- sign in / out


def login():
    if not enabled():
        return flask.redirect("/")
    meta = _metadata()
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(24)
    flask.session["oidc"] = {
        "state": state,
        "verifier": verifier,
        "next": _safe_next(flask.request.args.get("next")),
    }
    cfg = _config()
    assert cfg
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": _callback_url(),
        "scope": "openid profile email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return flask.redirect(meta["authorization_endpoint"] + "?" + urlencode(params))


def callback():
    pending = flask.session.pop("oidc", None)
    cfg = _config()
    if not (cfg and isinstance(pending, dict)):
        return flask.redirect("/")
    if flask.request.args.get("error") or flask.request.args.get("state") != pending.get("state"):
        log.warning("sign-in rejected: %s", flask.request.args.get("error") or "state mismatch")
        return flask.redirect(pending.get("next") or "/")

    meta = _metadata()
    try:
        tokens = _fetch_json(
            meta["token_endpoint"],
            form={
                "grant_type": "authorization_code",
                "code": flask.request.args.get("code", ""),
                "redirect_uri": _callback_url(),
                "client_id": cfg["client_id"],
                "client_secret": cfg["secret"],
                "code_verifier": pending["verifier"],
            },
        )
        # the profile comes straight from the issuer with the fresh access token
        info = _fetch_json(meta["userinfo_endpoint"], token=tokens["access_token"])
    except Exception as exc:  # pylint: disable=broad-except
        log.error("sign-in failed: %s", exc)
        return flask.redirect(pending.get("next") or "/")

    if not info.get("sub"):
        return flask.redirect(pending.get("next") or "/")
    name = info.get("name") or info.get("preferred_username") or info.get("email") or ""
    flask.session.permanent = True
    flask.session["account"] = {
        "sub": str(info["sub"]),
        "name": str(name),
        "given_name": str(info.get("given_name") or name.split(" ")[0]),
        "email": str(info.get("email") or ""),
        "picture": str(info.get("picture") or ""),
    }
    flask.session["id_token"] = tokens.get("id_token", "")
    return flask.redirect(pending.get("next") or "/")


def logout():
    id_token = flask.session.pop("id_token", "")
    flask.session.pop("account", None)
    flask.session.pop("oidc", None)
    if not enabled():
        return flask.redirect("/")
    end = _metadata().get("end_session_endpoint")
    if not end:
        return flask.redirect("/")
    # signing out of Alexandria signs out of the account everywhere, like Google
    params = {"post_logout_redirect_uri": _base_url()}
    if id_token:
        params["id_token_hint"] = id_token
    return flask.redirect(end + "?" + urlencode(params))


# ----------------------------------------------------------------------- sync store


def _db_path() -> str:
    for folder in ("/var/cache/searxng", tempfile.gettempdir()):
        if os.path.isdir(folder) and os.access(folder, os.W_OK):
            return os.path.join(folder, "alexandria-accounts.db")
    return os.path.join(tempfile.gettempdir(), "alexandria-accounts.db")


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(_db_path(), timeout=5)
    con.execute("CREATE TABLE IF NOT EXISTS sync (sub TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL)")
    return con


def sync_data():  # pylint: disable=too-many-return-statements
    account = current()
    if not account:
        return jsonify({"error": "not signed in"}), 401

    if flask.request.method == "GET":
        with _db_lock, _db() as con:
            row = con.execute("SELECT data, updated FROM sync WHERE sub = ?", (account["sub"],)).fetchone()
        if not row:
            return _no_store(jsonify({"data": None, "updated": 0}))
        return _no_store(jsonify({"data": json.loads(row[0]), "updated": row[1]}))

    # PUT: our own page only (a cross-site form can't send this header or a JSON body)
    if flask.request.headers.get("X-Alexandria") != "1":
        return jsonify({"error": "forbidden"}), 403
    raw = flask.request.get_data(cache=False, as_text=True)
    if len(raw) > SYNC_MAX_BYTES:
        return jsonify({"error": "too large"}), 413
    try:
        incoming = json.loads(raw)
    except ValueError:
        return jsonify({"error": "bad json"}), 400
    if not isinstance(incoming, dict):
        return jsonify({"error": "bad json"}), 400
    clean = {key: incoming[key] for key in SYNC_KEYS if key in incoming and isinstance(incoming[key], str)}
    now = time.time()
    with _db_lock, _db() as con:
        con.execute(
            "INSERT INTO sync (sub, data, updated) VALUES (?, ?, ?) "
            "ON CONFLICT(sub) DO UPDATE SET data = excluded.data, updated = excluded.updated",
            (account["sub"], json.dumps(clean), now),
        )
    return _no_store(jsonify({"ok": True, "updated": now}))


def _no_store(response: flask.Response) -> flask.Response:
    response.headers["Cache-Control"] = "no-store"
    return response


# ----------------------------------------------------------------------- wiring


def register(app: flask.Flask) -> None:
    from datetime import timedelta  # pylint: disable=import-outside-toplevel

    app.config.setdefault("PERMANENT_SESSION_LIFETIME", timedelta(days=SESSION_DAYS))
    app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("SESSION_COOKIE_HTTPONLY", True)
    base = str(get_setting("server.base_url") or "")
    if base.startswith("https://"):
        app.config.setdefault("SESSION_COOKIE_SECURE", True)

    app.add_url_rule("/account/login", endpoint="account_login", view_func=login)
    app.add_url_rule("/account/callback", endpoint="account_callback", view_func=callback)
    app.add_url_rule("/account/logout", endpoint="account_logout", view_func=logout)
    app.add_url_rule("/account/data", endpoint="account_data", view_func=sync_data, methods=["GET", "PUT"])

    @app.context_processor
    def _account_context():
        cfg = _config()
        return {
            "accounts_enabled": cfg is not None,
            "account": current(),
            "account_manage_url": (cfg["issuer"] + "/settings/account") if cfg else "",
        }
