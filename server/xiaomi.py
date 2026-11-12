#!/usr/bin/env python3
"""Read the Mi Home cloud device list. Tokens stay in a local cache, not in the reply."""

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".xiaomi-devices.json"


def role(model, parent_id):
    name = model or ""
    if "sensor_switch" in name or ".remote" in name:
        return "button"
    if name.startswith("lumi.gateway"):
        return "hub"
    if "vacuum" in name or name.startswith("roborock.") or name.startswith("dreame."):
        return "vacuum"
    if any(part in name for part in ("plug", "socket", "powerstrip", "ctrl_86plug", "ctrl_ln1")):
        return "socket"
    if parent_id and any(part in name for part in ("switch", "remote", "sensor_switch")):
        return "button"
    if "sensor" in name or "magnet" in name or "weather" in name:
        return "sensor"
    if parent_id:
        return "zigbee"
    return "wifi"


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")


def load_cache():
    if not CACHE.exists():
        return None
    try:
        saved = json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(saved, list) or not saved:
        return None
    public = []
    for item in saved:
        if not isinstance(item, dict):
            continue
        public.append({key: value for key, value in item.items() if key not in {"token", "bleKey"}})
    return public


def main():
    username = os.environ.get("XIAOMI_USERNAME", "").strip()
    password = os.environ.get("XIAOMI_PASSWORD", "")
    country = os.environ.get("XIAOMI_SERVER", "de").strip() or "de"
    if not username or not password:
        cached = load_cache()
        if cached is None:
            emit({
                "configured": False,
                "ok": False,
                "reason": "Нужен вход Mi Home в .env: XIAOMI_USERNAME и XIAOMI_PASSWORD.",
            })
            return
        emit({
            "configured": True,
            "ok": True,
            "server": "cache",
            "reason": "Список с этого компьютера. Облако Mi Home ещё не обновляли.",
            "devices": cached,
        })
        return

    try:
        from micloud import MiCloud
    except ImportError:
        emit({"configured": True, "ok": False, "reason": "Не установлен пакет micloud."})
        return

    cloud = MiCloud(username, password)
    try:
        logged_in = cloud.login()
    except Exception as error:
        emit({"configured": True, "ok": False, "reason": "Вход в Mi Home не принят."})
        return
    if not logged_in:
        emit({"configured": True, "ok": False, "reason": "Вход в Mi Home не принят."})
        return

    try:
        raw = cloud.get_devices(country=country, raw=True, save=False) or []
    except Exception:
        emit({"configured": True, "ok": False, "reason": "Mi Home не отдал список устройств."})
        return

    seen = set()
    cached = []
    public = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        did = str(item.get("did") or "")
        if not did or did in seen:
            continue
        seen.add(did)
        model = str(item.get("model") or "")
        parent = str(item.get("parent_id") or item.get("parentId") or "")
        token = str(item.get("token") or "")
        record = {
            "did": did,
            "name": item.get("name") or model or "Устройство",
            "model": model,
            "role": role(model, parent),
            "online": bool(item.get("isOnline")),
            "ip": item.get("localip") or "",
            "parent": parent,
            "locale": country,
        }
        public.append(record)
        cached.append({**record, "token": token})

    try:
        CACHE.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass

    hubs = [item["name"] for item in public if item["role"] == "hub"]
    emit({
        "configured": True,
        "ok": True,
        "server": country,
        "reason": "Hub 2 найден." if hubs else "В аккаунте нет Hub 2. Список всё равно с облака.",
        "devices": public,
    })


if __name__ == "__main__":
    main()
