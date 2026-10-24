# SPDX-License-Identifier: AGPL-3.0-or-later
"""The Alexandria account is your Epistle account (Epistle = the mail service).

Signed in to Epistle's webmail in this browser = signed in to Alexandria, with no
click: the first page you open bounces once through the webmail, which says who is
signed in there (a one-time code, swapped server to server for the address and
name).  The Epistle side is ``server/internal/api/alexandria.go`` in the epistle
repo; the webmail's nginx hands ``/epistle/alexandria`` to it.

- ``ALEXANDRIA_EPISTLE_URL``  the webmail as browsers open it, default
  ``https://webmail.kodatrade.co.uk``; ``off`` = no accounts at all.
- ``ALEXANDRIA_EPISTLE_API``  where this server swaps the code, default the same
  host (``<url>/v1/alexandria/token``).

Routes:

- ``/account/login``     -> the webmail (``prompt=none`` for the silent check, else
                            its sign-in page if needed, then straight back)
- ``/account/callback``  <- back from the webmail with a code (or ``login_required``)
- ``/account/logout``    -> signs out of Alexandria only, and stops the silent sign-in
                            until "Sign in" is clicked again
- ``/account/data``      GET / PUT the synced start page state (shortcuts, recent searches,
                         weather city, widget switches), one small JSON per account

When it runs by itself: a browser page load (``Sec-Fetch-Mode: navigate``) of the
start page, results or preferences, at most every ``RECHECK_GUEST`` for guests and
every ``RECHECK_SIGNED_IN`` for accounts (so signing out of Epistle signs you out
here too, at the next check).  The synced state is SQLite in the ``alexandria-data``
volume, keyed by the mailbox address.
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
import urllib.error
import urllib.request
from urllib.parse import urlencode

import flask
from flask.json import jsonify

from searx import get_setting, logger

log = logger.getChild("accounts")

DEFAULT_EPISTLE = "https://webmail.kodatrade.co.uk"
SYNC_KEYS = ("sxng-home-prefs", "sxng-home-history", "sxng-home-shortcuts", "sxng-home-place")
SYNC_MAX_BYTES = 64 * 1024
SESSION_DAYS = 30
RECHECK_GUEST = 12 * 3600
RECHECK_SIGNED_IN = 6 * 3600
CHECK_COOKIE = "alexandria_checked"  # a guest was checked recently: no bounce until it runs out
SIGNED_OUT_COOKIE = "alexandria_signed_out"  # signed out here: no silent sign-in until "Sign in"
SILENT_PATHS = ("/", "/search", "/preferences")
_db_lock = threading.Lock()


def epistle_url() -> str:
    url = os.environ.get("ALEXANDRIA_EPISTLE_URL", DEFAULT_EPISTLE).strip().rstrip("/")
    return "" if url.lower() in ("", "off", "none", "no") else url


def _token_url() -> str:
    api = os.environ.get("ALEXANDRIA_EPISTLE_API", "").strip().rstrip("/") or epistle_url()
    return api + "/v1/alexandria/token"


def enabled() -> bool:
    return bool(epistle_url())


def _base_url() -> str:
    base = get_setting("server.base_url") or flask.request.url_root
    return str(base).rstrip("/") + "/"


def _callback_url() -> str:
    return _base_url() + "account/callback"


def _safe_next(target: str | None) -> str:
    # only same-site paths, never an open redirect
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return "/"


def current() -> dict[str, str] | None:
    account = flask.session.get("account")
    return account if isinstance(account, dict) else None


def _swap(code: str, verifier: str) -> dict[str, t.Any]:
    # Epistle is our own server: talk to it directly, not through the engines' outgoing network
    body = json.dumps({"code": code, "code_verifier": verifier, "redirect_uri": _callback_url()}).encode()
    req = urllib.request.Request(
        _token_url(), data=body, headers={"Content-Type": "application/json", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=8) as resp:  # nosec B310: the URL comes from our own config
        return json.loads(resp.read().decode())


# ----------------------------------------------------------------------- sign in / out


def _to_epistle(next_path: str, silent: bool):
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(24)
    flask.session["epistle"] = {"state": state, "verifier": verifier, "next": next_path, "silent": silent}
    params = {"redirect_uri": _callback_url(), "state": state, "code_challenge": challenge}
    if silent:
        params["prompt"] = "none"
    response = flask.redirect(epistle_url() + "/epistle/alexandria?" + urlencode(params))
    response.headers["Cache-Control"] = "no-store"
    return response


def login():
    if not enabled():
        return flask.redirect("/")
    response = _to_epistle(_safe_next(flask.request.args.get("next")), silent=False)
    response.delete_cookie(SIGNED_OUT_COOKIE)
    return response


def callback():
    pending = flask.session.pop("epistle", None)
    if not (enabled() and isinstance(pending, dict)):
        return flask.redirect("/")
    next_path = _safe_next(pending.get("next"))
    args = flask.request.args
    response = flask.redirect(next_path)
    if args.get("state") != pending.get("state"):
        log.warning("sign-in rejected: state mismatch")
        return response
    if args.get("error"):
        # nobody signed in to Epistle in this browser: a guest (and an account that was signed out there ends here)
        flask.session.pop("account", None)
        response.set_cookie(CHECK_COOKIE, "1", max_age=RECHECK_GUEST, httponly=True, samesite="Lax")
        return response
    try:
        info = _swap(args.get("code", ""), pending["verifier"])
    except (urllib.error.URLError, ValueError, KeyError) as exc:
        log.error("sign-in failed: %s", exc)
        response.set_cookie(CHECK_COOKIE, "1", max_age=RECHECK_GUEST, httponly=True, samesite="Lax")
        return response
    email = str(info.get("email") or "").lower()
    if "@" not in email:
        return response
    name = str(info.get("name") or "").strip() or email.split("@")[0]
    flask.session.permanent = True
    flask.session["account"] = {
        "sub": email,
        "name": name,
        "given_name": name.split(" ")[0],
        "email": email,
        "picture": "",
        "checked": time.time(),
    }
    return response


def logout():
    flask.session.pop("account", None)
    flask.session.pop("epistle", None)
    response = flask.redirect("/")
    # otherwise the next page would sign you straight back in from Epistle
    response.set_cookie(SIGNED_OUT_COOKIE, "1", max_age=365 * 86400, httponly=True, samesite="Lax")
    return response


def silent_check():
    """``before_request``: bounce a page load through Epistle when it's time to (see the module doc)."""
    req = flask.request
    if not enabled() or req.method != "GET" or req.path not in SILENT_PATHS:
        return None
    # only real page loads in a browser: not fetches, prefetches, bots or the tests
    if req.headers.get("Sec-Fetch-Mode") != "navigate" or req.headers.get("Sec-Fetch-Dest", "document") != "document":
        return None
    if req.headers.get("Purpose") == "prefetch" or req.headers.get("Sec-Purpose"):
        return None
    if req.cookies.get(SIGNED_OUT_COOKIE):
        return None
    account = current()
    if account:
        if time.time() - float(account.get("checked") or 0) < RECHECK_SIGNED_IN:
            return None
    elif req.cookies.get(CHECK_COOKIE):
        return None
    return _to_epistle(_safe_next(req.full_path.rstrip("?")), silent=True)


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
    app.before_request(silent_check)

    @app.context_processor
    def _account_context():
        account = current()
        url = epistle_url()
        manage = ""
        if url and account:
            manage = url + "/epistle/jesus-is-god/" + account["email"] + "/Preferences"
        return {"accounts_enabled": bool(url), "account": account, "account_manage_url": manage}
