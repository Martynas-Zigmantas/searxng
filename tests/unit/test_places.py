# SPDX-License-Identifier: AGPL-3.0-or-later
# pylint: disable=missing-module-docstring,missing-class-docstring,protected-access

import searx.webapp
from searx import places
from tests import SearxTestCase


class InfoboxPlaceTestCase(SearxTestCase):

    def test_coordinates_and_ids(self):
        infobox = {
            "infobox": "British Museum",
            "urls": [
                {"title": "Official website", "url": "https://www.britishmuseum.org", "entity": "P856"},
                {
                    "title": "OpenStreetMap",
                    "url": "https://www.openstreetmap.org/?lat=51.519444&lon=-0.126944&zoom=19&layers=M",
                    "entity": "P625",
                },
                {"title": "Wikidata", "url": "http://www.wikidata.org/entity/Q6373"},
            ],
        }
        self.assertEqual(
            places.infobox_place(infobox),
            {
                "lat": 51.519444,
                "lon": -0.126944,
                "zoom": 17,
                "qid": "Q6373",
                "name": "British Museum",
                "web": "https://www.britishmuseum.org",
            },
        )

    def test_no_coordinates_no_card(self):
        self.assertIsNone(places.infobox_place({"infobox": "Python", "urls": [{"url": "https://python.org"}]}))
        self.assertIsNone(
            places.infobox_place({"urls": [{"url": "https://www.openstreetmap.org/?lat=91&lon=0", "entity": "P625"}]})
        )


class PlaceEndpointsTestCase(SearxTestCase):

    def setUp(self):
        super().setUp()
        self.app = searx.webapp.app.test_client()
        places._place_cache.clear()

    def test_tile_bounds(self):
        self.assertEqual(self.app.get("/widgets/tile/19/0/0.png").status_code, 404)
        self.assertEqual(self.app.get("/widgets/tile/2/4/0.png").status_code, 404)

    def test_place_details(self):
        tags = {
            "tourism": "museum",
            "opening_hours": "Sa-Th 10:00-17:00; Fr 10:00-20:30",
            "contact:phone": "+44 20 7323 8299",
            "website": "javascript:alert(1)",
        }
        self.setattr4test(places, "_lookup", lambda *_: (tags, ["Great Russell Street"], [51.5, 51.6, -0.2, -0.1]))
        data = self.app.get("/widgets/place?name=British+Museum&qid=Q6373&lat=51.5&lon=-0.12&web=https://bm.org").json
        self.assertEqual(data["kind"], "Museum")
        self.assertEqual(data["phone"], "+44 20 7323 8299")
        # a website that isn't http(s) is dropped; the official one from Wikidata stands in
        self.assertEqual(data["website"], "https://bm.org")
        self.assertEqual(data["bbox"], [51.5, 51.6, -0.2, -0.1])
        self.assertIn("directions?to=51.500000%2C-0.120000", data["directions"])

    def test_place_rejects_bad_input(self):
        self.assertEqual(self.app.get("/widgets/place?lat=x&lon=0").status_code, 400)
        self.assertEqual(self.app.get("/widgets/place?lat=0&lon=0&qid=../etc").status_code, 400)

    def test_kind_labels(self):
        self.assertEqual(places._kind({"office": "it"}), "IT office")
        self.assertEqual(places._kind({"office": "company"}), "Company office")
        self.assertEqual(places._kind({"building": "yes"}), "")
