# SPDX-License-Identifier: AGPL-3.0-or-later
"""Small JSON endpoints that feed the widgets on the start page.

The browser never talks to a third party: it asks this instance, and the
instance asks Open-Meteo (no API key, no account).

- ``/widgets/geocode?q=<city>``  ->  up to 5 matching places
- ``/widgets/weather?lat=<lat>&lon=<lon>``  ->  current weather + 3 days
- ``/widgets/locate``  ->  the rough location (city) of the visitor's IP
- ``/widgets/photo?not=<id>``  ->  the start page background: a random recent Bing photo of
  the day (title, credit, ``/widgets/photo/image?id=<id>&s=wide|tall``, fetched + cached here)

``/widgets/locate`` is the one exception to "only what the user typed": the
server asks ipwho.is (fallback ip-api.com) where the visitor's IP address is,
so the weather card works without picking a city.  Private / VPN addresses
can't be located, then the server's own public IP is used (same region for a
home server).  Results are cached in memory for 6 hours per IP.
"""

import ipaddress
import json
import os
import re
import secrets
import tempfile
import threading
import time

import flask
from flask.json import jsonify

from searx.network import get as http_get

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
LOCATE_TTL = 6 * 3600
_locate_cache: dict[str, tuple[float, dict]] = {}
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{3,120}$")


def _float_arg(name: str, low: float, high: float) -> float | None:
    try:
        value = float(flask.request.args.get(name, ""))
    except ValueError:
        return None
    if not low <= value <= high:
        return None
    return value


def _cached(response: flask.Response, seconds: int) -> flask.Response:
    response.headers["Cache-Control"] = f"private, max-age={seconds}"
    return response


def geocode():
    query = flask.request.args.get("q", "").strip()[:80]
    if len(query) < 2:
        return jsonify({"results": []})

    try:
        resp = http_get(
            GEOCODE_URL,
            params={"name": query, "count": 5, "language": "en", "format": "json"},
            timeout=4,
        )
        data = resp.json()
    except Exception:  # pylint: disable=broad-except
        return jsonify({"error": "geocoding unavailable"}), 502

    results = [
        {
            "name": place.get("name"),
            "region": ", ".join(x for x in (place.get("admin1"), place.get("country")) if x),
            "lat": place.get("latitude"),
            "lon": place.get("longitude"),
        }
        for place in data.get("results") or []
    ]
    return _cached(jsonify({"results": results}), 86400)


def weather():
    lat = _float_arg("lat", -90, 90)
    lon = _float_arg("lon", -180, 180)
    if lat is None or lon is None:
        return jsonify({"error": "lat/lon required"}), 400

    unit = "fahrenheit" if flask.request.args.get("unit") == "f" else "celsius"
    try:
        resp = http_get(
            FORECAST_URL,
            params={
                "latitude": round(lat, 3),
                "longitude": round(lon, 3),
                "current": "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min",
                "forecast_days": 4,
                "timezone": "auto",
                "temperature_unit": unit,
            },
            timeout=4,
        )
        data = resp.json()
    except Exception:  # pylint: disable=broad-except
        return jsonify({"error": "weather unavailable"}), 502

    current = data.get("current") or {}
    daily = data.get("daily") or {}
    days = [
        {"date": date, "code": code, "max": tmax, "min": tmin}
        for date, code, tmax, tmin in zip(
            daily.get("time", []),
            daily.get("weather_code", []),
            daily.get("temperature_2m_max", []),
            daily.get("temperature_2m_min", []),
        )
    ]
    return _cached(
        jsonify(
            {
                "unit": "°F" if unit == "fahrenheit" else "°C",
                "temp": current.get("temperature_2m"),
                "feels": current.get("apparent_temperature"),
                "code": current.get("weather_code"),
                "is_day": current.get("is_day", 1),
                "wind": current.get("wind_speed_10m"),
                "humidity": current.get("relative_humidity_2m"),
                "days": days,
            }
        ),
        600,
    )


def _visitor_ip() -> str | None:
    """Public IP of the visitor, or None for private / VPN / loopback addresses."""
    candidates = [flask.request.remote_addr or ""]
    candidates += [x.strip() for x in flask.request.headers.get("X-Forwarded-For", "").split(",")]
    candidates.append(flask.request.headers.get("X-Real-IP", ""))
    for raw in candidates:
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if ip.is_global:
            return str(ip)
    return None


def _lookup(ip: str | None) -> dict | None:
    target = ip or ""
    try:
        data = http_get(f"https://ipwho.is/{target}", timeout=4).json()
        if data.get("success"):
            return {
                "name": data.get("city") or data.get("region"),
                "region": ", ".join(x for x in (data.get("region"), data.get("country")) if x),
                "lat": data.get("latitude"),
                "lon": data.get("longitude"),
            }
    except Exception:  # pylint: disable=broad-except
        pass
    try:
        data = http_get(
            f"http://ip-api.com/json/{target}", params={"fields": "status,city,regionName,country,lat,lon"}, timeout=4
        ).json()
        if data.get("status") == "success":
            return {
                "name": data.get("city") or data.get("regionName"),
                "region": ", ".join(x for x in (data.get("regionName"), data.get("country")) if x),
                "lat": data.get("lat"),
                "lon": data.get("lon"),
            }
    except Exception:  # pylint: disable=broad-except
        pass
    return None


def locate():
    ip = _visitor_ip()
    key = ip or "server"
    hit = _locate_cache.get(key)
    if hit and time.time() - hit[0] < LOCATE_TTL:
        place = hit[1]
    else:
        place = _lookup(ip)
        if not place or place.get("lat") is None:
            return jsonify({"error": "location unavailable"}), 502
        if len(_locate_cache) > 1000:
            _locate_cache.clear()
        _locate_cache[key] = (time.time(), place)
    return _cached(jsonify({**place, "approximate": True}), 3600)


# ----------------------------------------------------------------------- photo of the day

# The start page background: a Bing photo of the day, a different one at every visit. The pool is the last ~2 weeks of
# Bing's English markets (refreshed every few hours) plus every photo seen since, up to PHOTO_POOL_MAX, kept on disk
# so a restart doesn't shrink it. The browser only ever talks to this instance: the pictures are fetched once and
# cached on disk (``/widgets/photo/image``), and only ids from the pool are fetched, never a URL from the request.
PHOTO_META_URL = "https://www.bing.com/HPImageArchive.aspx"
PHOTO_MARKETS = ("en-GB", "en-US", "en-IN", "en-CA", "en-AU", "en-NZ")
PHOTO_REFRESH = 6 * 3600
PHOTO_POOL_MAX = 60
PHOTO_SIZES = {"wide": "1920x1080", "tall": "1080x1920"}
_photo_lock = threading.Lock()
_photo_state: dict = {"fetched": 0.0, "pool": None}


def _photo_dir() -> str:
    for folder in ("/var/cache/searxng", tempfile.gettempdir()):
        if os.path.isdir(folder) and os.access(folder, os.W_OK):
            path = os.path.join(folder, "alexandria-photos")
            os.makedirs(path, exist_ok=True)
            return path
    return tempfile.gettempdir()


def _photo_id(urlbase: str) -> str:
    # "/th?id=OHR.YellowstoneWolves_EN-GB5342942021" -> "YellowstoneWolves_EN-GB5342942021"
    return urlbase.split("OHR.", 1)[-1].split("&", 1)[0]


def _load_pool() -> list[dict]:
    try:
        with open(os.path.join(_photo_dir(), "pool.json"), encoding="utf-8") as f:
            pool = json.load(f)
        return [p for p in pool if isinstance(p, dict) and SAFE_ID.match(str(p.get("id", "")))]
    except (OSError, ValueError):
        return []


def _save_pool(pool: list[dict]) -> None:
    try:
        tmp = os.path.join(_photo_dir(), "pool.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(pool, f)
        os.replace(tmp, os.path.join(_photo_dir(), "pool.json"))
    except OSError:
        pass


def _photo_pool() -> list[dict]:
    with _photo_lock:
        if _photo_state["pool"] is None:
            _photo_state["pool"] = _load_pool()
        if time.time() - _photo_state["fetched"] < PHOTO_REFRESH and _photo_state["pool"]:
            return _photo_state["pool"]
        _photo_state["fetched"] = time.time()
        fresh: list[dict] = []
        for mkt in PHOTO_MARKETS:
            for idx in (0, 8):
                try:
                    resp = http_get(PHOTO_META_URL, params={"format": "js", "idx": idx, "n": 8, "mkt": mkt}, timeout=5)
                    images = resp.json().get("images", [])
                except Exception:  # pylint: disable=broad-except
                    continue
                for image in images:
                    base = str(image.get("urlbase") or "")
                    pid = _photo_id(base)
                    # English captions only (a market can hand back another country's photo + caption)
                    if not (base.startswith("/th?id=OHR.") and SAFE_ID.match(pid) and "_EN-" in pid):
                        continue
                    fresh.append(
                        {
                            "id": pid,
                            "base": base,
                            "title": str(image.get("title") or ""),
                            "credit": str(image.get("copyright") or ""),
                        }
                    )
        # one per photo (the same picture has a different id per market): newest first, then what we had
        merged: list[dict] = []
        names: set[str] = set()
        for item in fresh + (_photo_state["pool"] or []):
            name = item["id"].split("_", 1)[0]
            if name not in names:
                names.add(name)
                merged.append(item)
        if fresh:
            _photo_state["pool"] = merged[:PHOTO_POOL_MAX]
            _save_pool(_photo_state["pool"])
        return _photo_state["pool"] or []


def photo():
    """A random photo from the pool (not the one this browser saw last: ``?not=<id>``)."""
    pool = _photo_pool()
    if not pool:
        return jsonify({"error": "photo unavailable"}), 502
    last = flask.request.args.get("not", "")
    choices = [p for p in pool if p["id"] != last] or pool
    pick = secrets.choice(choices)
    response = jsonify(
        {
            "id": pick["id"],
            "title": pick["title"],
            "credit": pick["credit"],
            "image": flask.url_for("widgets_photo_image", id=pick["id"]),
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def photo_image():
    pid = flask.request.args.get("id", "")
    size = PHOTO_SIZES.get(flask.request.args.get("s", "wide"), PHOTO_SIZES["wide"])
    photo_meta = next((p for p in _photo_pool() if p["id"] == pid), None)
    if not photo_meta:
        return flask.Response(status=404)
    path = os.path.join(_photo_dir(), f"{pid}_{size}.jpg")
    data = None
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        try:
            resp = http_get(f"https://www.bing.com{photo_meta['base']}_{size}.jpg", timeout=10)
        except Exception:  # pylint: disable=broad-except
            return flask.Response(status=502)
        if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
            return flask.Response(status=502)
        data = resp.content
        try:
            with open(path + ".tmp", "wb") as f:
                f.write(data)
            os.replace(path + ".tmp", path)
            _prune_photos()
        except OSError:
            pass
    response = flask.Response(data, mimetype="image/jpeg")
    # the URL names one picture: the browser can keep it
    response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
    return response


def _prune_photos() -> None:
    keep = {p["id"] for p in (_photo_state["pool"] or [])}
    folder = _photo_dir()
    for name in os.listdir(folder):
        if name.endswith(".jpg") and name.rsplit("_", 1)[0] not in keep:
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
