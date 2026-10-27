# SPDX-License-Identifier: AGPL-3.0-or-later
"""The Alexandria account is your Epistle account (Epistle = the mail service).

Signed in to Epistle's webmail in this browser = signed in to Alexandria, with no
click: the first page you open bounces once through the webmail, which says who is
signed in there (a one-time code, swapped server to server for the address and
name).  The Epistle side is ``server/internal/api/alexandria.go`` in the epistle
repo; the webmail's nginx hands ``/epistle/alexandria`` to it.

- ``ALEXANDRIA_EPISTLE_URL``  the webmail as browsers open it, default
  ``https://epistle.email``; ``off`` = no accounts at all.
- ``ALEXANDRIA_EPISTLE_API``  where this server swaps the code, default the same
  host (``<url>/v1/alexandria/token``).

Routes:

- ``/account/login``     -> the webmail (``prompt=none`` for the silent check, else
                            its sign-in page if needed, then straight back)
- ``/account/callback``  <- back from the webmail with a code (or ``login_required``)
- ``/account/logout``    -> signs out of Alexandria only, and stops the silent sign-in
                            until "Sign in" is clicked again
- ``/account/data``      GET / PUT the synced start page state (shortcuts, search history,
                         weather city, widget switches, background), one small JSON per account
- ``/account/mail``      the start page mail card: unread count + the newest few unread Inbox
                         letters, asked of epistle-api with the account's inbox token

Preferences (engines, theme, language, ...) follow the account too: saving them while signed
in stores them here (``prefs_after``), and another browser of the same account takes them on
at its next page load (``prefs_before``).  "Reset defaults" forgets them (``forget_prefs``).

The inbox token comes with the sign-in (``inbox_token``, 12 h, read-only, good for nothing but
``GET /v1/alexandria/inbox``).  It stays in this server's database, never in the browser; the
silent check signs in again before it runs out, which brings a new one.

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

DEFAULT_EPISTLE = "https://epistle.email"
SYNC_KEYS = ("sxng-home-prefs", "sxng-home-history", "sxng-history", "sxng-home-shortcuts", "sxng-home-place")
SYNC_MAX_BYTES = 256 * 1024
MAIL_TTL = 60  # seconds a mail card answer is reused
PREF_EXTRA_COOKIES = ("disabled_engines", "enabled_engines", "disabled_plugins", "enabled_plugins", "tokens")
SESSION_DAYS = 30
RECHECK_GUEST = 12 * 3600
RECHECK_SIGNED_IN = 6 * 3600
CHECK_COOKIE = "alexandria_checked"  # a guest was checked recently: no bounce until it runs out
SIGNED_OUT_COOKIE = "alexandria_signed_out"  # signed out here: no silent sign-in until "Sign in"
SILENT_PATHS = ("/", "/search", "/preferences", "/history")
_db_lock = threading.Lock()
_mail_cache: dict[str, tuple[float, dict[str, t.Any]]] = {}


def epistle_url() -> str:
    url = os.environ.get("ALEXANDRIA_EPISTLE_URL", DEFAULT_EPISTLE).strip().rstrip("/")
    return "" if url.lower() in ("", "off", "none", "no") else url


def _api_url(path: str) -> str:
    api = os.environ.get("ALEXANDRIA_EPISTLE_API", "").strip().rstrip("/") or epistle_url()
    return api + path


def _token_url() -> str:
    return _api_url("/v1/alexandria/token")


def _mailbox_url(email: str) -> str:
    # the webmail's own path for a signed-in mailbox (as on "Manage your Epistle account")
    return epistle_url() + "/epistle/jesus-is-god/" + email


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
    _keep_inbox_token(email, info.get("inbox_token"), info.get("inbox_expires"))
    return response


def logout():
    account = current()
    if account:
        with _db_lock, _db() as con:
            con.execute("DELETE FROM inbox WHERE sub = ?", (account["sub"],))
        _mail_cache.pop(account["sub"], None)
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
        fresh = time.time() - float(account.get("checked") or 0) < RECHECK_SIGNED_IN
        # signed in before the mail card existed, or the inbox token is about to run out: get a new one now
        token_ok = float(flask.session.get("inbox_until") or 0) > time.time() + 300
        if fresh and token_ok:
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
    con.execute("CREATE TABLE IF NOT EXISTS prefs (sub TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL)")
    con.execute("CREATE TABLE IF NOT EXISTS inbox (sub TEXT PRIMARY KEY, token TEXT NOT NULL, expires REAL NOT NULL)")
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


# ----------------------------------------------------------------------- preferences


def _store_prefs(account: dict[str, str]) -> None:
    now = time.time()
    data = flask.request.preferences.get_as_url_params()  # type: ignore[attr-defined]
    with _db_lock, _db() as con:
        con.execute(
            "INSERT INTO prefs (sub, data, updated) VALUES (?, ?, ?) "
            "ON CONFLICT(sub) DO UPDATE SET data = excluded.data, updated = excluded.updated",
            (account["sub"], data, now),
        )
    flask.session["prefs_seen"] = now


def prefs_before():
    """``before_request`` (after webapp's pre_request): this account's saved preferences, if this browser
    hasn't taken them on yet."""
    req = flask.request
    account = current()
    if not account or req.method != "GET" or req.path not in SILENT_PATHS or req.args.get("preferences"):
        return
    with _db_lock, _db() as con:
        row = con.execute("SELECT data, updated FROM prefs WHERE sub = ?", (account["sub"],)).fetchone()
    if not row:
        # the first browser that has saved preferences signs in: they become the account's
        prefs = req.preferences  # type: ignore[attr-defined]
        names = set(prefs.key_value_settings) | set(PREF_EXTRA_COOKIES)
        if names & set(req.cookies):
            _store_prefs(account)
        return
    data, updated = row
    if updated <= float(flask.session.get("prefs_seen") or 0):
        return
    prefs = req.preferences  # type: ignore[attr-defined]
    try:
        prefs.parse_encoded_data(data)
    except Exception as exc:  # pylint: disable=broad-except
        log.warning("stored preferences unreadable: %s", exc)
        return
    # what this request itself asks for (a category, a language in the URL) still wins, as in pre_request
    form = req.form  # type: ignore[attr-defined]
    if isinstance(form, dict) and form:
        prefs.parse_dict(form)
    flask.session["prefs_seen"] = updated
    flask.g.alexandria_prefs = True


def prefs_after(response: flask.Response) -> flask.Response:
    """``after_request``: write taken-on preferences into this browser's cookies; store saved ones."""
    account = current()
    if not account:
        return response
    req = flask.request
    if flask.g.get("alexandria_prefs"):
        req.preferences.save(response)  # type: ignore[attr-defined]
    elif (
        req.endpoint == "preferences"
        and 300 <= response.status_code < 400
        and (req.method == "POST" or req.args.get("preferences"))
    ):
        _store_prefs(account)
    return response


def forget_prefs() -> None:
    """"Reset defaults": the account's stored preferences go too, or the next page would bring them back."""
    account = current()
    if account:
        with _db_lock, _db() as con:
            con.execute("DELETE FROM prefs WHERE sub = ?", (account["sub"],))


# ----------------------------------------------------------------------- mail card


def _keep_inbox_token(sub: str, token: t.Any, expires: t.Any) -> None:
    if not (isinstance(token, str) and token):
        # an epistle-api without the inbox peek: don't bounce through Epistle on every page for a token
        flask.session["inbox_until"] = time.time() + RECHECK_SIGNED_IN
        return
    try:
        until = float(expires)
    except (TypeError, ValueError):
        until = time.time() + 12 * 3600
    with _db_lock, _db() as con:
        con.execute(
            "INSERT INTO inbox (sub, token, expires) VALUES (?, ?, ?) "
            "ON CONFLICT(sub) DO UPDATE SET token = excluded.token, expires = excluded.expires",
            (sub, token, until),
        )
    flask.session["inbox_until"] = until
    _mail_cache.pop(sub, None)


def _letter(raw: dict[str, t.Any], mailbox: str) -> dict[str, t.Any]:
    sender = raw.get("from") if isinstance(raw.get("from"), dict) else {}
    return {
        "from": str(sender.get("name") or sender.get("email") or "Unknown sender"),
        "email": str(sender.get("email") or ""),
        "subject": str(raw.get("subject") or ""),
        "encrypted": bool(raw.get("encrypted")),
        "date": str(raw.get("date") or ""),
        "url": mailbox + "/Mail/view#!/Mail/0/INBOX/" + str(int(raw.get("uid") or 0)),
    }


def mail():
    account = current()
    if not account:
        return jsonify({"state": "signed_out"}), 401
    sub = account["sub"]
    hit = _mail_cache.get(sub)
    if hit and time.time() - hit[0] < MAIL_TTL:
        return _no_store(jsonify(hit[1]))
    with _db_lock, _db() as con:
        row = con.execute("SELECT token, expires FROM inbox WHERE sub = ?", (sub,)).fetchone()
    if not row or row[1] < time.time():
        return _no_store(jsonify({"state": "unavailable"}))
    req = urllib.request.Request(
        _api_url("/v1/alexandria/inbox"), headers={"Authorization": "Bearer " + row[0], "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:  # nosec B310: the URL comes from our own config
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            with _db_lock, _db() as con:
                con.execute("DELETE FROM inbox WHERE sub = ?", (sub,))
            flask.session.pop("inbox_until", None)
        log.warning("mail card: epistle-api said %s", exc.code)
        return _no_store(jsonify({"state": "unavailable"}))
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        log.warning("mail card: %s", exc)
        return _no_store(jsonify({"state": "unavailable"}))
    mailbox = _mailbox_url(account["email"])
    messages = data.get("messages") if isinstance(data.get("messages"), list) else []
    out = {
        "state": "ok",
        "unseen": int(data.get("unseen") or 0),
        "messages": [_letter(m, mailbox) for m in messages if isinstance(m, dict)],
        "inbox_url": mailbox + "/Mail/view#!/Mail/0/INBOX",
        "compose_url": mailbox + "/Mail/view#!/Mail/0/new",
    }
    if len(_mail_cache) > 1000:
        _mail_cache.clear()
    _mail_cache[sub] = (time.time(), out)
    return _no_store(jsonify(out))


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
    app.add_url_rule("/account/mail", endpoint="account_mail", view_func=mail)
    app.before_request(silent_check)
    app.before_request(prefs_before)
    app.after_request(prefs_after)

    @app.context_processor
    def _account_context():
        account = current()
        url = epistle_url()
        manage = mailbox = ""  # mailbox = the signed-in Inbox, for the Mail pill
        if url and account:
            manage = _mailbox_url(account["email"]) + "/Preferences"
            mailbox = _mailbox_url(account["email"]) + "/Mail/view#!/Mail/0/INBOX"
        return {
            "accounts_enabled": bool(url),
            "account": account,
            "account_manage_url": manage,
            "account_mail_url": mailbox,
        }
