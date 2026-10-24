# SPDX-License-Identifier: AGPL-3.0-or-later
# pylint: disable=missing-module-docstring,missing-class-docstring,missing-function-docstring

import json
import os
import tempfile

import searx.accounts
import searx.webapp
from tests import SearxTestCase

ENV = {
    "ALEXANDRIA_OIDC_ISSUER": "https://id.example.test",
    "ALEXANDRIA_OIDC_CLIENT_ID": "client",
    "ALEXANDRIA_OIDC_CLIENT_SECRET": "secret",
}
META = {
    "authorization_endpoint": "https://id.example.test/authorize",
    "token_endpoint": "https://id.example.test/api/oidc/token",
    "userinfo_endpoint": "https://id.example.test/api/oidc/userinfo",
    "end_session_endpoint": "https://id.example.test/api/oidc/end-session",
}


class AccountsTestCase(SearxTestCase):

    def setUp(self):
        super().setUp()
        self.app = searx.webapp.app.test_client()
        self.tmp = tempfile.mkdtemp()
        self.setattr4test(searx.accounts, "_db_path", lambda: os.path.join(self.tmp, "accounts.db"))
        self.setattr4test(searx.accounts, "_metadata", lambda: META)
        for key in ENV:
            os.environ.pop(key, None)

    def tearDown(self):
        for key in ENV:
            os.environ.pop(key, None)
        super().tearDown()

    def _enable(self):
        os.environ.update(ENV)

    def test_disabled_without_env(self):
        self.assertFalse(searx.accounts.enabled())
        resp = self.app.get("/account/login")
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.headers["Location"], "/")

    def test_login_redirects_with_pkce(self):
        self._enable()
        resp = self.app.get("/account/login?next=/search%3Fq%3Dx")
        self.assertEqual(resp.status_code, 302)
        location = resp.headers["Location"]
        self.assertTrue(location.startswith(META["authorization_endpoint"] + "?"))
        self.assertIn("code_challenge_method=S256", location)
        self.assertIn("client_id=client", location)

    def test_open_redirect_blocked(self):
        self.assertEqual(searx.accounts._safe_next("//evil.test/x"), "/")  # pylint: disable=protected-access
        self.assertEqual(searx.accounts._safe_next("https://evil.test"), "/")  # pylint: disable=protected-access
        self.assertEqual(searx.accounts._safe_next("/search?q=a"), "/search?q=a")  # pylint: disable=protected-access

    def test_callback_rejects_bad_state(self):
        self._enable()
        self.app.get("/account/login")
        resp = self.app.get("/account/callback?code=abc&state=wrong")
        self.assertEqual(resp.status_code, 302)
        with self.app.session_transaction() as sess:
            self.assertNotIn("account", sess)

    def test_callback_signs_in(self):
        self._enable()
        self.app.get("/account/login")
        with self.app.session_transaction() as sess:
            state = sess["oidc"]["state"]
        calls = []

        def fake_fetch(url, form=None, token=""):
            calls.append(url)
            if url == META["token_endpoint"]:
                assert form and form["code"] == "abc" and form["code_verifier"]
                return {"access_token": "at", "id_token": "it"}
            assert token == "at"
            return {"sub": "u1", "name": "Martynas Z", "given_name": "Martynas", "email": "m@example.test"}

        self.setattr4test(searx.accounts, "_fetch_json", fake_fetch)
        resp = self.app.get(f"/account/callback?code=abc&state={state}")
        self.assertEqual(resp.status_code, 302)
        with self.app.session_transaction() as sess:
            self.assertEqual(sess["account"]["sub"], "u1")
            self.assertEqual(sess["account"]["given_name"], "Martynas")
        self.assertEqual(calls, [META["token_endpoint"], META["userinfo_endpoint"]])
        # signed in: the header shows the account menu instead of "Sign in"
        page = self.app.get("/").data.decode()
        self.assertIn("account-menu", page)
        self.assertNotIn("account-signin", page)

    def test_data_requires_sign_in(self):
        self._enable()
        self.assertEqual(self.app.get("/account/data").status_code, 401)

    def test_data_roundtrip_and_csrf(self):
        self._enable()
        with self.app.session_transaction() as sess:
            sess["account"] = {"sub": "u1", "name": "M", "given_name": "M", "email": "", "picture": ""}
        self.assertIsNone(json.loads(self.app.get("/account/data").data)["data"])
        body = json.dumps({"sxng-home-history": '["a"]', "evil-key": "x", "sxng-home-place": 5})
        # no X-Alexandria header -> refused
        self.assertEqual(self.app.put("/account/data", data=body).status_code, 403)
        resp = self.app.put("/account/data", data=body, headers={"X-Alexandria": "1"})
        self.assertEqual(resp.status_code, 200)
        stored = json.loads(self.app.get("/account/data").data)["data"]
        self.assertEqual(stored, {"sxng-home-history": '["a"]'})
        big = json.dumps({"sxng-home-history": "x" * (70 * 1024)})
        self.assertEqual(self.app.put("/account/data", data=big, headers={"X-Alexandria": "1"}).status_code, 413)

    def test_signed_out_header(self):
        self._enable()
        page = self.app.get("/").data.decode()
        self.assertIn("account-signin", page)
        os.environ.pop("ALEXANDRIA_OIDC_ISSUER")
        page = self.app.get("/").data.decode()
        self.assertNotIn("account-signin", page)
