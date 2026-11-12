#!/usr/bin/env python3
"""Live mains check. A plug that answers on the LAN has city power. Tokens stay local."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from miio import MiIO

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".xiaomi-devices.json"


def plugs():
    if not CACHE.exists():
        return []
    saved = json.loads(CACHE.read_text(encoding="utf-8"))
    return [
        item for item in saved
        if item.get("role") == "socket" and item.get("ip") and isinstance(item.get("token"), str) and len(item["token"]) == 32
    ]


def as_bool(value):
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    return None


def as_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def probe(plug):
    device = MiIO(plug["ip"], plug["token"], timeout=2.4, tries=2)
    result = device.send("get_properties", [
        {"did": plug.get("did") or "switch", "siid": 2, "piid": 1},
        {"did": plug.get("did") or "power", "siid": 11, "piid": 2},
    ])
    rows = result.get("result") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        raise RuntimeError("offline")
    values = {}
    for item in rows:
        if isinstance(item, dict) and item.get("code") == 0:
            values[(item.get("siid"), item.get("piid"))] = item.get("value")
    return {
        "name": plug.get("name"),
        "online": True,
        "switch": as_bool(values.get((2, 1))),
        "power_w": as_number(values.get((11, 2))),
    }


def safe_probe(plug):
    try:
        return probe(plug)
    except (OSError, ValueError, RuntimeError):
        return {"name": plug.get("name"), "online": False, "switch": None, "power_w": None}


def main():
    with ThreadPoolExecutor(max_workers=4) as pool:
        found = list(pool.map(safe_probe, plugs()))
    online = [item for item in found if item["online"]]
    if online:
        state = "on"
        detail = "Розетка відповіла в локальній мережі, отже на ній є міське живлення."
    elif found:
        state = "unknown"
        detail = "Розетки не відповіли. Це ще не доказ, що світла немає."
    else:
        state = "unknown"
        detail = "Немає локальних розеток для перевірки."
    print(json.dumps({
        "state": state,
        "source": "cuco.plug.v2eur",
        "detail": detail,
        "plugs": found,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
