# SPDX-License-Identifier: AGPL-3.0-or-later
"""The place card: a knowledge panel for a place or a business gets a map and its details.

- ``infobox_place`` (Jinja filter): the coordinates (+ Wikidata id) of an infobox that has them, from the
  OpenStreetMap link the wikidata engine adds for P625, else None.
- ``/widgets/tile/<z>/<x>/<y>.png``  ->  an OpenStreetMap map tile, through this instance: the browser never talks
  to OpenStreetMap.  Only the tiles somebody looks at are fetched, then kept on disk for TILE_KEEP; the folder never
  grows past TILE_CACHE_MAX (the least recently shown go first).
- ``/widgets/vtile/<z>/<x>/<y>.pbf``  ->  the same for vector tiles (OpenFreeMap, map data the browser colours in
  Alexandria's own style), kept gzipped and sent gzipped.
- ``/widgets/cards?ids=N…,W…``  ->  the Map tab's cards: kind of place, stars, hours, phone, website, photo (one
  Nominatim lookup + one Wikidata request for the whole page, cached a day).
- ``/widgets/place?name=<name>&qid=<Q…>&lat=<lat>&lon=<lon>&web=<official website>``  ->  what OpenStreetMap knows
  about it (kind of place, address, opening hours, phone, website): Nominatim searched for the name right around the
  coordinates (the object tagged with that Wikidata id, else the nearest match), else the address at the coordinates.
  Cached in memory for a day.  (Overpass would match the Wikidata id exactly, but its public server is too often
  "at capacity" to sit behind every place search.)
"""

from __future__ import annotations

import gzip
import os
import re
import tempfile
import threading
import time
from urllib.parse import parse_qs, quote, urlparse

import flask
from flask.json import jsonify

from searx import logger
from searx.network import get as http_get

log = logger.getChild("places")

# OpenStreetMap's tile and Nominatim policies want a real name and a way to reach the operator
USER_AGENT = "Alexandria/1.0 (+https://alexandria.epistle.email)"

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
TILE_MAX_ZOOM = 18
TILE_KEEP = 14 * 86400
TILE_CACHE_MAX = 200 * 1024 * 1024
# map data for our own map style: OpenFreeMap (OpenStreetMap in the OpenMapTiles schema, free, no key, no limits)
VECTOR_TILEJSON = "https://tiles.openfreemap.org/planet"
VECTOR_MAX_ZOOM = 14  # deeper zooms reuse the z14 tile (over-zoom)
_vector_state: dict = {"url": None, "at": 0.0}
_tile_lock = threading.Lock()
_tile_state: dict = {"bytes": None}

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
PLACE_KEEP = 86400
PLACE_CACHE_MAX = 500
_place_cache: dict[str, tuple[float, dict]] = {}

QID = re.compile(r"^Q[0-9]{1,12}$")


# ----------------------------------------------------------------------------------------------- the infobox


def infobox_place(infobox: dict) -> dict | None:
    """``{"lat", "lon", "zoom", "qid"}`` of an infobox with coordinates, else None."""
    lat = lon = None
    zoom = 16
    qid = web = ""
    for url in infobox.get("urls") or []:
        href = str(url.get("url") or "")
        parsed = urlparse(href)
        if url.get("entity") == "P625" or (parsed.netloc.endswith("openstreetmap.org") and "lat=" in parsed.query):
            args = parse_qs(parsed.query)
            try:
                lat = float(args["lat"][0])
                lon = float(args["lon"][0])
                zoom = int(args.get("zoom", ["16"])[0])
            except (KeyError, ValueError, IndexError):
                continue
        elif url.get("entity") == "P856" and parsed.scheme in ("http", "https"):
            web = web or href
        elif parsed.netloc.endswith("wikidata.org"):
            tail = parsed.path.rstrip("/").rsplit("/", 1)[-1]
            if QID.match(tail):
                qid = tail
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    name = str(infobox.get("infobox") or "")[:120]
    return {
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "zoom": max(3, min(zoom, 17)),
        "qid": qid,
        "name": name,
        "web": web,
    }


# ----------------------------------------------------------------------------------------------- map tiles


def _tile_dir() -> str:
    for folder in ("/var/cache/searxng", tempfile.gettempdir()):
        if os.path.isdir(folder) and os.access(folder, os.W_OK):
            path = os.path.join(folder, "alexandria-tiles")
            os.makedirs(path, exist_ok=True)
            return path
    return tempfile.gettempdir()


def _tile_files(root: str) -> list[tuple[float, int, str]]:
    found = []
    for folder, _, files in os.walk(root):
        for name in files:
            path = os.path.join(folder, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            found.append((st.st_mtime, st.st_size, path))
    return found


def _tile_added(root: str, size: int) -> None:
    """Count what's on disk; past TILE_CACHE_MAX drop the least recently shown tiles down to 80 %."""
    with _tile_lock:
        if _tile_state["bytes"] is None:
            _tile_state["bytes"] = sum(s for _, s, _ in _tile_files(root))
        _tile_state["bytes"] += size
        if _tile_state["bytes"] <= TILE_CACHE_MAX:
            return
        files = sorted(_tile_files(root))
        total = sum(s for _, s, _ in files)
        for _, s, path in files:
            if total <= TILE_CACHE_MAX * 0.8:
                break
            try:
                os.remove(path)
                total -= s
            except OSError:
                pass
        _tile_state["bytes"] = total


def _cached_tile(path: str, url: str, accept, mimetype: str, gzipped: bool = False, trim=lambda raw: raw):
    """A tile from the disk cache (fresh for TILE_KEEP), else fetched from ``url`` and kept."""
    root = _tile_dir()
    data = stale = None
    try:
        fresh = time.time() - os.stat(path).st_mtime < TILE_KEEP
        with open(path, "rb") as f:
            data = f.read()
        os.utime(path)  # recently shown: the last to go when the folder is full
        if not fresh:
            data, stale = None, data
    except OSError:
        data = None
    if data is None:
        try:
            resp = http_get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
            good = resp.status_code == 200 and accept(resp)
        except Exception:  # pylint: disable=broad-except
            good = False
        if not good:
            # the source unreachable: an old copy beats a hole in the map
            if not stale:
                return flask.Response(status=502)
            data = stale
        else:
            data = gzip.compress(trim(resp.content), 9) if gzipped else resp.content
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path + ".tmp", "wb") as f:
                    f.write(data)
                os.replace(path + ".tmp", path)
                _tile_added(root, len(data))
            except OSError:
                pass
    response = flask.Response(data, mimetype=mimetype)
    if gzipped:
        response.headers["Content-Encoding"] = "gzip"
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response


def tile(z: int, x: int, y: int):  # pylint: disable=invalid-name
    if not (0 <= z <= TILE_MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
        return flask.Response(status=404)
    return _cached_tile(
        os.path.join(_tile_dir(), str(z), str(x), f"{y}.png"),
        TILE_URL.format(z=z, x=x, y=y),
        lambda resp: resp.headers.get("content-type", "").startswith("image/"),
        "image/png",
    )


def _vector_tiles_url() -> str | None:
    """OpenFreeMap's tile URL carries the week's build; ask its TileJSON, at most once a day."""
    now = time.time()
    if _vector_state["url"] and now - _vector_state["at"] < 86400:
        return _vector_state["url"]
    try:
        resp = http_get(VECTOR_TILEJSON, headers={"User-Agent": USER_AGENT}, timeout=8)
        _vector_state["url"] = resp.json()["tiles"][0]
        _vector_state["at"] = now
    except Exception:  # pylint: disable=broad-except
        pass
    return _vector_state["url"]


# ---- trimming: a full OpenFreeMap tile carries every shop and ~100 translations of every name (80 KB at z14).
# Keep only the layers and properties mapStyle.ts draws: about a quarter of the bytes.

VECTOR_KEEP: dict[str, tuple[str, ...]] = {
    "water": ("class",),
    "waterway": ("class",),
    "landcover": ("class",),
    "landuse": ("class",),
    "park": ("class",),
    "boundary": ("admin_level", "maritime"),
    "building": (),
    "transportation": ("class", "brunnel"),
    "transportation_name": ("name", "class"),
    "place": ("name", "class", "rank"),
    "water_name": ("name", "class"),
    "poi": ("name", "class", "rank"),
}
POI_MAX_RANK = 4  # only the landmarks: OpenMapTiles ranks POIs per tile, 1 = most important
# footways, tracks, driveways and car parks: half the bytes of a city-centre tile, and clutter
ROAD_DROP = {b"path", b"track", b"service", b"bridleway", b"cycleway", b"footway", b"steps", b"pier"}


def _varint(buf: bytes, pos: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            return value, pos


def _fields(buf: bytes):
    """(field number, wire type, value) of a protobuf message."""
    pos = 0
    while pos < len(buf):
        key, pos = _varint(buf, pos)
        num, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = _varint(buf, pos)
        elif wire == 2:
            size, pos = _varint(buf, pos)
            value, pos = buf[pos : pos + size], pos + size
        elif wire in (1, 5):
            size = 8 if wire == 1 else 4
            value, pos = buf[pos : pos + size], pos + size
        else:
            raise ValueError("bad wire type")
        yield num, wire, value


def _enc_varint(num: int) -> bytes:
    out = bytearray()
    while True:
        byte = num & 0x7F
        num >>= 7
        if num:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _field(num: int, wire: int, value) -> bytes:
    if wire == 0:
        return _enc_varint(num << 3) + _enc_varint(value)
    if wire == 2:
        return _enc_varint(num << 3 | 2) + _enc_varint(len(value)) + value
    return _enc_varint(num << 3 | wire) + value


def _packed(buf: bytes) -> list[int]:
    out, pos = [], 0
    while pos < len(buf):
        value, pos = _varint(buf, pos)
        out.append(value)
    return out


def _value_number(raw: bytes) -> float | None:
    for num, wire, value in _fields(raw):
        if wire == 0:
            return float(value >> 1 ^ -(value & 1)) if num == 6 else float(value)
    return None


def _keep_feature(layer: str, pairs: list[tuple[int, int]], keys: list[str], values: list[bytes]) -> bool:
    """Drop footpaths & co. from the roads, and every POI but the landmarks."""
    if layer in ("transportation", "transportation_name"):
        cls = next((values[vi] for ki, vi in pairs if keys[ki] == "class"), b"")
        return not any(_field(1, 2, drop) == cls for drop in ROAD_DROP)
    if layer == "poi":
        rank = next((_value_number(values[vi]) for ki, vi in pairs if keys[ki] == "rank"), None)
        return rank is not None and rank <= POI_MAX_RANK
    return True


def _trim_layer(raw: bytes) -> bytes | None:
    name, keys, values, feats, rest = "", [], [], [], []
    for num, wire, value in _fields(raw):
        if num == 2:
            feats.append(value)
        elif num == 3:
            keys.append(value.decode())
        elif num == 4:
            values.append(value)
        else:
            if num == 1:
                name = value.decode()
            rest.append((num, wire, value))
    if name not in VECTOR_KEEP:
        return None
    wanted = VECTOR_KEEP[name]
    new_keys: dict[int, int] = {}
    new_values: dict[int, int] = {}
    out_feats = []
    for feat in feats:
        parts = list(_fields(feat))
        tags = next((_packed(v) for n, _, v in parts if n == 2), [])
        pairs = [(tags[i], tags[i + 1]) for i in range(0, len(tags) - 1, 2) if keys[tags[i]] in wanted]
        if not _keep_feature(name, pairs, keys, values):
            continue
        packed = b"".join(
            _enc_varint(new_keys.setdefault(ki, len(new_keys)))
            + _enc_varint(new_values.setdefault(vi, len(new_values)))
            for ki, vi in pairs
        )
        body = b"".join(_field(n, w, v) for n, w, v in parts if n not in (1, 2))  # feature ids: not needed
        out_feats.append(body + (_field(2, 2, packed) if packed else b""))
    if not out_feats:
        return None
    out = b"".join(_field(n, w, v) for n, w, v in rest)
    out += b"".join(_field(2, 2, feat) for feat in out_feats)
    out += b"".join(_field(3, 2, keys[k].encode()) for k in sorted(new_keys, key=new_keys.__getitem__))
    out += b"".join(_field(4, 2, values[v]) for v in sorted(new_values, key=new_values.__getitem__))
    return out


def trim_vector_tile(raw: bytes) -> bytes:
    """Only the layers / properties our style uses (VECTOR_KEEP); on anything unexpected the tile as it came."""
    try:
        out = b""
        for num, _, value in _fields(raw):
            if num == 3:
                layer = _trim_layer(value)
                if layer is not None:
                    out += _field(3, 2, layer)
        return out
    except Exception:  # pylint: disable=broad-except
        return raw


def vtile(z: int, x: int, y: int):  # pylint: disable=invalid-name
    """A vector tile (map data, not a picture): the browser colours it in Alexandria's own style (main/mapStyle.ts)."""
    if not (0 <= z <= VECTOR_MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
        return flask.Response(status=404)
    url = _vector_tiles_url()
    path = os.path.join(_tile_dir(), "v", str(z), str(x), f"{y}.pbf.gz")
    if not url and not os.path.exists(path):
        return flask.Response(status=502)
    return _cached_tile(
        path,
        (url or "").format(z=z, x=x, y=y),
        lambda resp: "vector-tile" in resp.headers.get("content-type", "") or resp.content[:1] != b"<",
        "application/vnd.mapbox-vector-tile",
        gzipped=True,
        trim=trim_vector_tile,
    )


# ----------------------------------------------------------------------------------------------- place details

# the tag that says what kind of place it is, most telling first
KIND_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "craft", "healthcare", "historic", "building")


ACRONYMS = {"it": "IT", "atm": "ATM", "ngo": "NGO", "diy": "DIY", "tv": "TV"}


def _kind(tags: dict) -> str:
    for key in KIND_KEYS:
        value = str(tags.get(key) or "")
        if value and value not in ("yes", "no"):
            kind = value.split(";", 1)[0].replace("_", " ").capitalize()
            kind = " ".join(ACRONYMS.get(w.lower(), w) for w in kind.split())
            # office=company -> "Company office", building=office -> "Office"
            return f"{kind} office" if key == "office" and "office" not in kind.lower() else kind
    return ""


def _web(value: str) -> str:
    value = value.split(";", 1)[0].strip()
    return value if value.startswith(("https://", "http://")) else ""


def _address(address: dict) -> list[str]:
    street = " ".join(p for p in (address.get("house_number"), address.get("road")) if p)
    town = address.get("city") or address.get("town") or address.get("village") or address.get("suburb")
    town = " ".join(p for p in (town, address.get("postcode")) if p)
    return [line for line in (street, town, address.get("country", "")) if line]


def _nominatim(url: str, params: dict):
    resp = http_get(
        url,
        params={"format": "jsonv2", "addressdetails": 1, **params},
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        timeout=6,
    )
    return resp.json() if resp.status_code == 200 else None


def _bbox(result: dict) -> list[float]:
    """Nominatim's [south, north, west, east] as numbers, or []."""
    try:
        box = [float(v) for v in result.get("boundingbox") or []]
    except (TypeError, ValueError):
        return []
    return box if len(box) == 4 else []


def _lookup(name: str, qid: str, lat: float, lon: float) -> tuple[dict, list[str], list[float]]:
    """(OSM tags, address lines, outline box) of the place."""
    found = []
    if name:
        d = 0.02  # ~2 km around the coordinates
        found = (
            _nominatim(
                NOMINATIM_SEARCH_URL,
                {
                    "q": name,
                    "viewbox": f"{lon - d},{lat + d},{lon + d},{lat - d}",
                    "bounded": 1,
                    "extratags": 1,
                    "limit": 5,
                },
            )
            or []
        )
    if found:
        # the one tagged with this Wikidata id, else the nearest
        best = next(
            (r for r in found if qid and (r.get("extratags") or {}).get("wikidata") == qid),
            min(found, key=lambda r: (float(r.get("lat", 0)) - lat) ** 2 + (float(r.get("lon", 0)) - lon) ** 2),
        )
        tags = dict(best.get("extratags") or {})
        tags.setdefault(str(best.get("category") or ""), str(best.get("type") or ""))
        return tags, _address(best.get("address") or {}), _bbox(best)
    result = _nominatim(NOMINATIM_REVERSE_URL, {"lat": lat, "lon": lon, "zoom": 18}) or {}
    return {}, _address(result.get("address") or {}), []


def place():
    args = flask.request.args
    qid = args.get("qid", "")
    try:
        lat, lon = float(args.get("lat", "")), float(args.get("lon", ""))
    except ValueError:
        return jsonify({"error": "lat and lon"}), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (qid and not QID.match(qid)):
        return jsonify({"error": "lat and lon"}), 400

    name = args.get("name", "").strip()[:120]
    official = _web(args.get("web", ""))
    key = f"{qid}|{name}|{lat:.5f}|{lon:.5f}"
    hit = _place_cache.get(key)
    if hit and time.time() - hit[0] < PLACE_KEEP:
        data = hit[1]
    else:
        try:
            tags, address, bbox = _lookup(name, qid, lat, lon)
        except Exception:  # pylint: disable=broad-except
            tags, address, bbox = {}, [], []
        data = {
            "kind": _kind(tags),
            "address": address,
            "hours": str(tags.get("opening_hours") or ""),
            "phone": str(tags.get("phone") or tags.get("contact:phone") or "").split(";", 1)[0].strip(),
            "website": _web(str(tags.get("website") or tags.get("contact:website") or tags.get("url") or ""))
            or official,
            "directions": f"https://www.openstreetmap.org/directions?to={lat:.6f}%2C{lon:.6f}",
            "bbox": bbox,
        }
        if len(_place_cache) >= PLACE_CACHE_MAX:
            _place_cache.clear()
        _place_cache[key] = (time.time(), data)
    response = jsonify(data)
    response.headers["Cache-Control"] = "private, max-age=3600"
    return response


# ----------------------------------------------------------------------------------------------- Map tab cards

NOMINATIM_LOOKUP_URL = "https://nominatim.openstreetmap.org/lookup"
WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
OSM_REF = re.compile(r"^[NWR][0-9]{1,12}$")
LOOKUP_MAX = 20
_cards_cache: dict[str, tuple[float, dict]] = {}


def _stars(value: str) -> int:
    match = re.match(r"^([1-7])", value or "")
    return int(match.group(1)) if match else 0


def _card_info(found: dict) -> dict:
    tags = found.get("extratags") or {}
    kind = (found.get("type") or "").replace("_", " ")
    if kind in ("yes", "attraction", "building"):
        kind = (found.get("category") or "").replace("_", " ")
    cuisine = (tags.get("cuisine") or "").split(";")[0].replace("_", " ")
    if cuisine and kind in ("restaurant", "fast food", "cafe"):
        kind = f"{cuisine} {kind}"
    return {
        "kind": kind[:1].upper() + kind[1:],
        "stars": _stars(tags.get("stars", "")),
        "hours": tags.get("opening_hours", ""),
        "phone": tags.get("phone") or tags.get("contact:phone") or "",
        "website": tags.get("website") or tags.get("contact:website") or "",
        "wheelchair": tags.get("wheelchair", ""),
        "wikidata": tags.get("wikidata", "") if QID.match(tags.get("wikidata", "")) else "",
        "image": "",
    }


def _wikidata_photos(qids: list[str]) -> dict[str, str]:
    """Q-id -> a Wikimedia Commons thumbnail of its picture (P18), in one Wikidata request."""
    if not qids:
        return {}
    try:
        resp = http_get(
            WIKIDATA_API_URL,
            params={"action": "wbgetentities", "ids": "|".join(qids), "props": "claims", "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=6,
        )
        entities = resp.json().get("entities", {}) if resp.status_code == 200 else {}
    except Exception:  # pylint: disable=broad-except
        return {}
    photos = {}
    for qid, entity in entities.items():
        try:
            name = entity["claims"]["P18"][0]["mainsnak"]["datavalue"]["value"]
        except (KeyError, IndexError, TypeError):
            continue
        photos[qid] = (
            "https://commons.wikimedia.org/wiki/Special:FilePath/" + quote(name.replace(" ", "_")) + "?width=240"
        )
    return photos


def cards():
    """``/widgets/cards?ids=N1,W2,…``: kind of place, stars, hours, phone, website, wheelchair, photo for the Map
    tab's cards (main/mapMode.ts): one Nominatim lookup + one Wikidata request for all of them, cached a day."""
    refs = [ref for ref in flask.request.args.get("ids", "").split(",") if OSM_REF.match(ref)][:LOOKUP_MAX]
    now = time.time()
    missing = [ref for ref in refs if ref not in _cards_cache or now - _cards_cache[ref][0] > PLACE_KEEP]
    if missing:
        try:
            found = _nominatim(NOMINATIM_LOOKUP_URL, {"osm_ids": ",".join(missing), "extratags": 1})
        except Exception as exc:  # pylint: disable=broad-except
            log.warning("cards lookup failed: %s", exc)
            found = None
        if found is None:
            # Nominatim down / slow: nothing remembered, the next search asks again
            missing, found = [], []
        infos = {f"{r.get('osm_type', ' ')[0].upper()}{r.get('osm_id')}": _card_info(r) for r in found}
        photos = _wikidata_photos(sorted({i["wikidata"] for i in infos.values() if i["wikidata"]}))
        for info in infos.values():
            info["image"] = photos.get(info["wikidata"], "")
        if len(_cards_cache) > PLACE_CACHE_MAX * 4:
            _cards_cache.clear()
        for ref in missing:
            # not found is remembered too: no new request for it on every search
            _cards_cache[ref] = (now, infos.get(ref, {}))
    response = jsonify({ref: _cards_cache[ref][1] for ref in refs if ref in _cards_cache})
    response.headers["Cache-Control"] = "private, max-age=3600"
    return response


def register(app: flask.Flask) -> None:
    app.jinja_env.filters["infobox_place"] = infobox_place  # pylint: disable=no-member
    app.add_url_rule(
        "/widgets/tile/<int:z>/<int:x>/<int:y>.png", methods=["GET"], endpoint="widgets_tile", view_func=tile
    )
    app.add_url_rule(
        "/widgets/vtile/<int:z>/<int:x>/<int:y>.pbf", methods=["GET"], endpoint="widgets_vtile", view_func=vtile
    )
    app.add_url_rule("/widgets/place", methods=["GET"], endpoint="widgets_place", view_func=place)
    app.add_url_rule("/widgets/cards", methods=["GET"], endpoint="widgets_cards", view_func=cards)
