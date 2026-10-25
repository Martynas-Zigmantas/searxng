# SPDX-License-Identifier: AGPL-3.0-or-later
# pylint: disable=missing-module-docstring,missing-class-docstring,missing-function-docstring,protected-access

import io
import json
import os
import tempfile
import time
import urllib.error
from urllib.parse import parse_qs, urlparse

import searx.accounts
import searx.webapp
from tests import SearxTestCase

EPISTLE = "https://mail.example.test"
NAVIGATE = {"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"}


class AccountsTestCase(SearxTestCase):

    def setUp(self):
        super().setUp()
        self.app = searx.webapp.app.test_client()
        self.tmp = tempfile.mkdtemp()
        self.setattr4test(searx.accounts, "_db_path", lambda: os.path.join(self.tmp, "accounts.db"))
        self.swapped = []

        def swap(code, verifier):
            self.swapped.append((code, verifier))
            return {"email": "M.Z@Koda.test", "name": "Martynas Zigmantas"}

        self.setattr4test(searx.accounts, "_swap", swap)
        os.environ["ALEXANDRIA_EPISTLE_URL"] = EPISTLE

    def tearDown(self):
        os.environ.pop("ALEXANDRIA_EPISTLE_URL", None)
        super().tearDown()

    def _bounce(self, resp):
        self.assertEqual(resp.status_code, 302)
        location = urlparse(resp.headers["Location"])
        self.assertEqual(f"{location.scheme}://{location.netloc}{location.path}", EPISTLE + "/epistle/alexandria")
        return {k: v[0] for k, v in parse_qs(location.query).items()}

    def _sign_in(self, next_path="/"):
        query = self._bounce(self.app.get("/account/login?next=" + next_path))
        return self.app.get(f"/account/callback?code=abc&state={query['state']}")

    def test_off(self):
        os.environ["ALEXANDRIA_EPISTLE_URL"] = "off"
        self.assertFalse(searx.accounts.enabled())
        self.assertEqual(self.app.get("/account/login").headers["Location"], "/")
        self.assertEqual(self.app.get("/", headers=NAVIGATE).status_code, 200)
        self.assertNotIn(b"account-signin", self.app.get("/").data)

    def test_sign_in_button_goes_to_epistle_with_pkce(self):
        self.assertIn(b"account-signin", self.app.get("/").data)
        query = self._bounce(self.app.get("/account/login?next=/search%3Fq%3Dx"))
        self.assertEqual(query["redirect_uri"], "http://localhost/account/callback")
        self.assertEqual(len(query["code_challenge"]), 43)
        self.assertNotIn("prompt", query)

    def test_callback_signs_in(self):
        resp = self._sign_in("/search%3Fq%3Dx")
        self.assertEqual(resp.headers["Location"], "/search?q=x")
        self.assertEqual(self.swapped[0][0], "abc")
        page = self.app.get("/").data
        self.assertIn(b"m.z@koda.test", page)
        self.assertIn(b"Hi, Martynas!", page)
        self.assertIn(EPISTLE.encode() + b"/epistle/jesus-is-god/m.z@koda.test/Preferences", page)

    def test_state_mismatch_rejected(self):
        self._bounce(self.app.get("/account/login"))
        self.app.get("/account/callback?code=abc&state=wrong")
        self.assertEqual(self.swapped, [])
        self.assertNotIn(b"account-menu", self.app.get("/").data)

    def test_silent_check_once_for_guests(self):
        # only real page loads bounce: fetches and the tests' plain requests don't
        self.assertEqual(self.app.get("/").status_code, 200)
        query = self._bounce(self.app.get("/search?q=rust", headers=NAVIGATE))
        self.assertEqual(query["prompt"], "none")
        resp = self.app.get(f"/account/callback?error=login_required&state={query['state']}")
        self.assertEqual(resp.headers["Location"], "/search?q=rust")
        self.assertEqual(self.swapped, [])
        # checked: no bounce again for a while
        self.assertEqual(self.app.get("/", headers=NAVIGATE).status_code, 200)

    def test_silent_check_signs_in_and_out(self):
        query = self._bounce(self.app.get("/", headers=NAVIGATE))
        self.app.get(f"/account/callback?code=abc&state={query['state']}")
        self.assertIn(b"account-menu", self.app.get("/", headers=NAVIGATE).data)
        # hours later Epistle says nobody is signed in any more: signed out here too
        with self.app.session_transaction() as sess:
            sess["account"]["checked"] = 0
        query = self._bounce(self.app.get("/", headers=NAVIGATE))
        self.app.get(f"/account/callback?error=login_required&state={query['state']}")
        self.assertNotIn(b"account-menu", self.app.get("/").data)

    def test_sign_out_stops_silent_sign_in(self):
        self._sign_in()
        self.app.get("/account/logout")
        self.assertNotIn(b"account-menu", self.app.get("/").data)
        self.assertEqual(self.app.get("/", headers=NAVIGATE).status_code, 200)
        # "Sign in" clears it again
        self._bounce(self.app.get("/account/login"))
        self.assertEqual(self.app.get("/", headers=NAVIGATE).status_code, 302)

    def test_open_redirect_blocked(self):
        self.assertEqual(searx.accounts._safe_next("//evil.test/x"), "/")
        self.assertEqual(searx.accounts._safe_next("https://evil.test/"), "/")
        self.assertEqual(searx.accounts._safe_next("/\\evil.test"), "/")
        self.assertEqual(searx.accounts._safe_next("/search?q=1"), "/search?q=1")

    def test_sync_needs_account(self):
        self.assertEqual(self.app.get("/account/data").status_code, 401)

    def test_sync_round_trip(self):
        self._sign_in()
        self.assertEqual(self.app.get("/account/data").json, {"data": None, "updated": 0})
        body = {"sxng-home-history": json.dumps(["rust"]), "evil": "x"}
        self.assertEqual(self.app.put("/account/data", data=json.dumps(body)).status_code, 403)
        resp = self.app.put("/account/data", data=json.dumps(body), headers={"X-Alexandria": "1"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.app.get("/account/data").json["data"], {"sxng-home-history": json.dumps(["rust"])})

    def test_sync_too_large(self):
        self._sign_in()
        big = json.dumps({"sxng-home-history": "x" * (300 * 1024)})
        self.assertEqual(self.app.put("/account/data", data=big, headers={"X-Alexandria": "1"}).status_code, 413)

    # ---------------------------------------------------------------- preferences follow the account

    def _cookies(self, resp):
        return {h.split("=", 1)[0]: h.split("=", 1)[1].split(";", 1)[0] for h in resp.headers.getlist("Set-Cookie")}

    def test_preferences_follow_the_account(self):
        self._sign_in()
        resp = self.app.post("/preferences", data={"safesearch": "2", "category_general": "1"})
        self.assertEqual(resp.status_code, 302)
        # another browser, same Epistle account: takes them on at its first page
        other = searx.webapp.app.test_client()
        self.app, mine = other, self.app
        self._sign_in()
        cookies = self._cookies(self.app.get("/"))
        self.assertEqual(cookies.get("safesearch"), "2")
        # once: the next page doesn't write them again
        self.assertNotIn("safesearch", self._cookies(self.app.get("/")))
        self.app = mine

    def test_first_browser_with_preferences_brings_them(self):
        self.app.set_cookie("safesearch", "1")
        self._sign_in()
        self.app.get("/")
        with searx.accounts._db() as con:
            row = con.execute("SELECT data FROM prefs WHERE sub = ?", ("m.z@koda.test",)).fetchone()
        self.assertIsNotNone(row)

    def test_reset_defaults_forgets_the_account_preferences(self):
        self._sign_in()
        self.app.post("/preferences", data={"safesearch": "2"})
        self.app.get("/clear_cookies")
        with searx.accounts._db() as con:
            self.assertIsNone(con.execute("SELECT 1 FROM prefs").fetchone())

    # ---------------------------------------------------------------- mail card

    def _sign_in_with_inbox(self):
        def swap(code, verifier):
            self.swapped.append((code, verifier))
            return {"email": "m.z@koda.test", "name": "M Z", "inbox_token": "tok-1", "inbox_expires": time.time() + 3600}

        self.setattr4test(searx.accounts, "_swap", swap)
        self._sign_in()

    def _epistle_answers(self, answer):
        calls = []

        def urlopen(req, timeout=0):
            calls.append(req)
            if isinstance(answer, Exception):
                raise answer
            return io.BytesIO(json.dumps(answer).encode())

        self.setattr4test(searx.accounts.urllib.request, "urlopen", urlopen)
        searx.accounts._mail_cache.clear()
        return calls

    def test_mail_needs_account(self):
        self.assertEqual(self.app.get("/account/mail").status_code, 401)

    def test_mail_card(self):
        self._sign_in_with_inbox()
        letter = {"from": {"name": "Tomas", "email": "t@x.test"}, "subject": "Cabin", "encrypted": False,
                  "date": "2026-10-24T07:08:53Z", "uid": 13}
        calls = self._epistle_answers({"unseen": 4, "messages": [letter]})
        data = self.app.get("/account/mail").json
        self.assertEqual(calls[0].full_url, EPISTLE + "/v1/alexandria/inbox")
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer tok-1")
        self.assertEqual(data["state"], "ok")
        self.assertEqual(data["unseen"], 4)
        self.assertEqual(data["messages"][0]["from"], "Tomas")
        self.assertEqual(
            data["messages"][0]["url"], EPISTLE + "/epistle/jesus-is-god/m.z@koda.test/Mail/view#!/Mail/0/INBOX/13"
        )
        # the token never goes to the browser
        self.assertNotIn(b"tok-1", self.app.get("/account/mail").data)
        self.assertNotIn(b"tok-1", self.app.get("/").data)

    def test_mail_token_refused_is_dropped(self):
        self._sign_in_with_inbox()
        self._epistle_answers(urllib.error.HTTPError("u", 401, "no", {}, None))
        self.assertEqual(self.app.get("/account/mail").json["state"], "unavailable")
        with searx.accounts._db() as con:
            self.assertIsNone(con.execute("SELECT 1 FROM inbox").fetchone())
        # and the next page load signs in again for a new one
        self.assertEqual(self.app.get("/", headers=NAVIGATE).status_code, 302)

    def test_sign_out_drops_the_inbox_token(self):
        self._sign_in_with_inbox()
        self.app.get("/account/logout")
        with searx.accounts._db() as con:
            self.assertIsNone(con.execute("SELECT 1 FROM inbox").fetchone())

    def test_history_page(self):
        page = self.app.get("/history")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"history_app", page.data)
        self.assertIn(b"Only on this device", page.data)
        self._sign_in()
        self.assertIn(b"Kept in your Epistle account (m.z@koda.test)", self.app.get("/history").data)


class PhotoTestCase(SearxTestCase):
    """The start page photo: a random one from the pool, never a URL from the request."""

    def setUp(self):
        super().setUp()
        import searx.home_widgets as hw  # pylint: disable=import-outside-toplevel

        self.hw = hw
        self.app = searx.webapp.app.test_client()
        pool = [
            {"id": "Wolves_EN-GB1", "base": "/th?id=OHR.Wolves_EN-GB1", "title": "Wolves", "credit": "(c) a"},
            {"id": "Clock_EN-GB2", "base": "/th?id=OHR.Clock_EN-GB2", "title": "Clock", "credit": "(c) b"},
        ]
        self.setattr4test(hw, "_photo_pool", lambda: pool)

    def test_never_the_last_one(self):
        for _ in range(10):
            data = self.app.get("/widgets/photo?not=Wolves_EN-GB1").json
            self.assertEqual(data["id"], "Clock_EN-GB2")
        self.assertIn("/widgets/photo/image?id=Clock_EN-GB2", data["image"])

    def test_only_pool_ids_are_fetched(self):
        self.assertEqual(self.app.get("/widgets/photo/image?id=../../etc/passwd").status_code, 404)
        self.assertEqual(self.app.get("/widgets/photo/image?id=Other_EN-GB9").status_code, 404)
