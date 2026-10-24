# SPDX-License-Identifier: AGPL-3.0-or-later
# pylint: disable=missing-module-docstring,missing-class-docstring,missing-function-docstring,protected-access

import json
import os
import tempfile
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
        big = json.dumps({"sxng-home-history": "x" * (70 * 1024)})
        self.assertEqual(self.app.put("/account/data", data=big, headers={"X-Alexandria": "1"}).status_code, 413)
