#!/usr/bin/env python3
"""Read-only LAN discovery for the owner's /24 network."""

import ipaddress
import json
import re
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".network-scan.json"
LABELS = ROOT / ".network-labels.json"
XIAOMI = ROOT / ".xiaomi-devices.json"
TTL = 60


def read_json(file, fallback):
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def local_ip():
    # Выбираем интерфейс, через который Mac достигает домашнего хаба.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect(("192.168.0.208", 54321))
        return connection.getsockname()[0]


def reachable(ip):
    try:
        result = subprocess.run(
            ["/sbin/ping", "-n", "-c", "1", "-W", "500", str(ip)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
        )
        return str(ip) if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def arp_table():
    try:
        output = subprocess.check_output(["/usr/sbin/arp", "-an"], text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return {}
    found = {}
    for ip, mac in re.findall(r"\((\d+(?:\.\d+){3})\) at ([0-9a-f:]+)", output, re.I):
        if mac.count(":") == 5:
            found[ip] = ":".join(part.zfill(2) for part in mac.lower().split(":"))
    return found


def scan():
    address = local_ip()
    subnet = ipaddress.ip_network(f"{address}/24", strict=False)
    # Параллельный ICMP-опрос ограничен 32 процессами и только своей подсетью.
    with ThreadPoolExecutor(max_workers=32) as pool:
        active = [item for item in pool.map(reachable, subnet.hosts()) if item]
    macs = arp_table()
    xiaomi = {
        item.get("ip"): item
        for item in read_json(XIAOMI, [])
        if isinstance(item, dict) and item.get("ip")
    }
    devices = []
    for ip in active:
        known = xiaomi.get(ip, {})
        devices.append({
            "ip": ip,
            "mac": macs.get(ip),
            "name": "Роутер" if ip == str(subnet.network_address + 1) else known.get("name") or f"Устройство {ip}",
            "kind": "Роутер" if ip == str(subnet.network_address + 1) else known.get("role") or "неизвестно",
        })
    return {"scanned_at": time.time(), "network": str(subnet), "local_ip": address, "devices": devices}


def main():
    now = time.time()
    cached = read_json(CACHE, {})
    if not isinstance(cached, dict) or now - cached.get("scanned_at", 0) > TTL:
        cached = scan()
        tmp = CACHE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CACHE)
    labels = read_json(LABELS, {})
    if not isinstance(labels, dict):
        labels = {}
    devices = []
    found_people = set()
    for item in cached.get("devices", []):
        key = item.get("mac") or f"ip:{item['ip']}"
        label = labels.get(key, {})
        person = label.get("person") if isinstance(label, dict) else None
        if person:
            found_people.add(person)
        devices.append({
            **item,
            "key": key,
            "name": label.get("name") or item["name"] if isinstance(label, dict) else item["name"],
            "person": person,
            "responding": True,
        })
    people = sorted({
        item.get("person") for item in labels.values()
        if isinstance(item, dict) and item.get("person")
    })
    print(json.dumps({
        "ok": True,
        "network": cached.get("network"),
        "local_ip": cached.get("local_ip"),
        "scanned_at": cached.get("scanned_at"),
        "devices": devices,
        "people": [{"name": name, "detected": name in found_people} for name in people],
        "note": "ICMP показывает ответившие устройства. Спящий телефон может не ответить; отсутствие ответа не доказывает отсутствие человека дома.",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
