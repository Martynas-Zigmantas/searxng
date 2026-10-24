# SPDX-License-Identifier: AGPL-3.0-or-later
"""Small JSON endpoints that feed the widgets on the start page.

The browser never talks to a third party: it asks this instance, and the
instance asks Open-Meteo (no API key, no account).

- ``/widgets/geocode?q=<city>``  ->  up to 5 matching places
- ``/widgets/weather?lat=<lat>&lon=<lon>``  ->  current weather + 3 days
- ``/widgets/locate``  ->  the rough location (city) of the visitor's IP

``/widgets/locate`` is the one exception to "only what the user typed": the
server asks ipwho.is (fallback ip-api.com) where the visitor's IP address is,
so the weather card works without picking a city.  Private / VPN addresses
can't be located, then the server's own public IP is used (same region for a
home server).  Results are cached in memory for 6 hours per IP.
"""

import ipaddress
import time

import flask
from flask.json import jsonify

from searx.network import get as http_get

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
LOCATE_TTL = 6 * 3600
_locate_cache: dict[str, tuple[float, dict]] = {}
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


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
