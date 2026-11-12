#!/usr/bin/env python3
"""Live miIO reads and commands. Secrets stay in .xiaomi-devices.json."""

import binascii
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from mibeacon import (
    decrypt_frame,
    frame_mac,
    frame_product,
    reading_from_objects,
    selftest as beacon_selftest,
)
from miio import MiIO

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".xiaomi-devices.json"
READING = ROOT / ".xiaomi-reading.json"
SCANNER = Path("/tmp/vexto-ble-scan")
BLE_TTL = 90
HT_MAC_TEXT = "A4:C1:38:E8:24:EC"
HT_MAC = bytes.fromhex("A4C138E824EC")
HT_MAC_REV = HT_MAC[::-1]
HT_DID = "blt.4.1q3ua2sspgc00"
DOOR_DID = "blt.4.1q6so60n9g000"
MOTION_DID = "lumi.158d0008834325"
BUTTON_DID = "lumi.158d000895ab04"
PLUGS = (
    {"id": "plug-1", "ip": "192.168.0.146"},
    {"id": "plug-2", "ip": "192.168.0.219"},
)
VACUUM_IP = "192.168.0.177"
HUB_IP = "192.168.0.208"
ZIGBEE_GAP = "Хаб видит устройство в списке Zigbee, но состояние по miIO не отдаёт. MQTT на хабе закрыт, telnet не включал."


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")


def load_devices():
    try:
        saved = json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return saved if isinstance(saved, list) else []


def remember_thermometer_mac(devices):
    changed = False
    for item in devices:
        if isinstance(item, dict) and item.get("did") == HT_DID and item.get("mac") != HT_MAC_TEXT:
            item["mac"] = HT_MAC_TEXT
            changed = True
    if not changed:
        return
    tmp = CACHE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(devices, ensure_ascii=False), encoding="utf-8")
    tmp.replace(CACHE)


def by_ip(devices, ip):
    for item in devices:
        if not isinstance(item, dict) or item.get("ip") != ip:
            continue
        token = item.get("token")
        if isinstance(token, str) and len(token) == 32:
            return item
    return None


def by_did(devices, did):
    for item in devices:
        if isinstance(item, dict) and item.get("did") == did:
            return item
    return None


def ble_key(record):
    if not isinstance(record, dict):
        return None
    raw = record.get("bleKey")
    if not isinstance(raw, str) or len(raw) != 32:
        return None
    try:
        key = bytes.fromhex(raw)
    except ValueError:
        return None
    return key if len(key) == 16 else None


def call(record, method, params, timeout=4.0):
    try:
        client = MiIO(record["ip"], record["token"], timeout=timeout)
        return client.send(method, params)
    except (binascii.Error, ValueError, OSError):
        return {"error": "protocol"}


def missed(parsed):
    return not isinstance(parsed, dict) or parsed.get("error") in ("timeout", "offline", "protocol")


def prop_map(parsed):
    found = {}
    if not isinstance(parsed, dict):
        return found
    rows = parsed.get("result")
    if not isinstance(rows, list):
        return found
    for item in rows:
        if not isinstance(item, dict) or item.get("code") != 0 or "value" not in item:
            continue
        found[(item.get("siid"), item.get("piid"))] = item.get("value")
    return found


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


def result_code(parsed):
    if not isinstance(parsed, dict):
        return None
    if parsed.get("error") in ("timeout", "offline", "protocol"):
        return parsed["error"]
    error = parsed.get("error")
    if isinstance(error, dict) and isinstance(error.get("code"), int):
        return error["code"]
    result = parsed.get("result")
    if isinstance(result, dict) and isinstance(result.get("code"), int):
        return result["code"]
    if isinstance(result, list):
        codes = [item.get("code") for item in result if isinstance(item, dict) and isinstance(item.get("code"), int)]
        if codes:
            return codes[0]
        return 0
    if "result" in parsed:
        return 0
    return None


def accepted(parsed):
    return result_code(parsed) in (0, 1)


def read_plug(record, plug_id):
    name = record.get("name") if isinstance(record.get("name"), str) else plug_id
    parsed = call(record, "get_properties", [
        {"did": record.get("did") or plug_id, "siid": 2, "piid": 1},
        {"did": record.get("did") or plug_id, "siid": 11, "piid": 2},
    ])
    if missed(parsed):
        return {"id": plug_id, "name": name, "on": None, "power_w": None, "error": "Розетка не ответила."}
    props = prop_map(parsed)
    switch = as_bool(props.get((2, 1)))
    power = as_number(props.get((11, 2)))
    if switch is None:
        return {"id": plug_id, "name": name, "on": None, "power_w": None, "error": "Розетка не отдала включение."}
    view = {"id": plug_id, "name": name, "on": switch, "power_w": power, "error": None}
    if power is None:
        view["power_error"] = "Розетка не отдала мощность."
    return view


def vacuum_view(status, battery, charging):
    labels = {
        1: ("idle", "Ожидание"),
        2: ("dock", "Заряжается"),
        3: ("dock", "Заряжается и продолжит"),
        4: ("clean", "Убирает"),
        5: ("pause", "Пауза"),
        6: ("returning", "Едет на базу"),
        7: ("clean", "Моет тряпку"),
        8: ("clean", "Пульт"),
        9: ("dock", "Заряжен"),
        10: ("clean", "Строит карту"),
        11: ("idle", "Обновление"),
        12: ("dock", "База занята"),
        13: ("returning", "Едет на базу"),
        14: ("dock", "Работа базы"),
        15: ("error", "Ошибка"),
        16: ("clean", "Метёт и моет"),
        17: ("clean", "Моет"),
        18: ("pause", "Пауза карты"),
        19: ("returning", "Едет на базу"),
        20: ("returning", "Едет промыть тряпку"),
        21: ("returning", "Едет на базу"),
        22: ("dock", "Мойка на базе"),
        23: ("dock", "Мойка закончена"),
        24: ("returning", "Едет на базу"),
    }
    if isinstance(status, int) and status in labels:
        return labels[status]
    if charging == 1:
        return "dock", "Заряжается"
    if isinstance(status, int):
        return "idle", f"Статус {status}"
    return "unknown", "Нет статуса"


def read_vacuum(record):
    name = record.get("name") if isinstance(record.get("name"), str) else "Robot Vacuum S40"
    did = record.get("did") or "vacuum"
    parsed = call(record, "get_properties", [
        {"did": did, "siid": 2, "piid": 2},
        {"did": did, "siid": 3, "piid": 1},
        {"did": did, "siid": 3, "piid": 2},
    ])
    if missed(parsed):
        return {
            "name": name,
            "mode": "unknown",
            "label": "Нет статуса",
            "status": None,
            "battery": None,
            "charging": None,
            "error": "Пылесос не ответил.",
        }
    props = prop_map(parsed)
    status = props.get((2, 2))
    battery = props.get((3, 1))
    charging = props.get((3, 2))
    status = status if isinstance(status, int) else None
    battery = battery if isinstance(battery, int) and 0 <= battery <= 100 else None
    charging = charging if isinstance(charging, int) else None
    mode, label = vacuum_view(status, battery, charging)
    error = None
    if status is None and battery is None:
        error = "Пылесос не отдал состояние."
    return {
        "name": name,
        "mode": mode,
        "label": label,
        "status": status,
        "battery": battery,
        "charging": charging == 1 if charging is not None else None,
        "error": error,
    }


def read_hub(record):
    info = call(record, "miIO.info", [])
    listed = call(record, "get_device_list", [])
    firmware = None
    online = False
    if isinstance(info, dict) and isinstance(info.get("result"), dict):
        online = True
        fw = info["result"].get("fw_ver")
        firmware = fw if isinstance(fw, str) else None
    children = []
    rows = listed.get("result") if isinstance(listed, dict) else None
    if isinstance(rows, list):
        online = True
        for item in rows:
            if isinstance(item, dict) and isinstance(item.get("did"), str):
                model = item.get("model") if isinstance(item.get("model"), str) else ""
                children.append({"did": item["did"], "model": model})
    return {
        "online": online,
        "firmware": firmware,
        "children": children,
        "error": None if online else "Хаб не ответил по miIO.",
    }


def zigbee_view(hub, did):
    if not hub.get("online"):
        return {"listed": False, "error": hub.get("error") or "Хаб не ответил по miIO."}
    listed = any(item.get("did") == did for item in hub.get("children") or [])
    if not listed:
        return {"listed": False, "error": "Хаб ответил, но этого устройства нет в его списке Zigbee."}
    return {"listed": True, "error": ZIGBEE_GAP}


def load_reading():
    try:
        saved = json.loads(READING.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return saved if isinstance(saved, dict) else {}


def save_reading(payload):
    tmp = READING.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(READING)


def fresh(entry, now, field):
    if not isinstance(entry, dict) or not isinstance(entry.get("at"), (int, float)):
        return False
    if entry.get(field) is None:
        return False
    return now - entry["at"] <= BLE_TTL


def ensure_scanner():
    src = Path(__file__).resolve().parent / "ble_scan.swift"
    if SCANNER.exists() and SCANNER.stat().st_mtime >= src.stat().st_mtime:
        return SCANNER
    for compiler in ("swiftc", "/usr/bin/swiftc"):
        try:
            subprocess.run(
                [compiler, "-Onone", "-o", str(SCANNER), str(src)],
                check=True,
                timeout=90,
                capture_output=True,
            )
            return SCANNER
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def scan_ble(ht_key, door_key, seconds=10):
    binary = ensure_scanner()
    found = {
        "state": None,
        "temperature": None,
        "humidity": None,
        "door": None,
        "ht_heard": False,
        "ht_unlocked": False,
        "ht_objects": [],
        "door_heard": False,
        "error": None,
    }
    if binary is None:
        found["error"] = "На этом Mac не собрался сканер Bluetooth."
        return found
    if ht_key is None and door_key is None:
        found["error"] = "В локальном файле нет ключа BLE."
        return found
    try:
        proc = subprocess.run(
            [str(binary), str(seconds)],
            capture_output=True,
            timeout=seconds + 8,
            text=True,
        )
    except subprocess.TimeoutExpired:
        found["error"] = "Сканер Bluetooth не закончил вовремя."
        return found
    except OSError:
        found["error"] = "Сканер Bluetooth не запустился."
        return found
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if item.get("event") == "state":
            found["state"] = str(item.get("code") or "")
            continue
        if item.get("event") not in ("adv", "mfg"):
            continue
        try:
            raw = bytes.fromhex(str(item.get("hex") or ""))
        except ValueError:
            continue
        for frame in candidate_frames(raw):
            absorb_frame(frame, ht_key, door_key, found)
    if found["state"] == "3":
        found["error"] = "macOS не дал этому процессу доступ к Bluetooth."
    elif found["state"] == "4":
        found["error"] = "Bluetooth на Mac выключен."
    elif found["state"] == "2":
        found["error"] = "Bluetooth на этом Mac недоступен."
    elif found["state"] != "5" and found["error"] is None and not found["ht_heard"]:
        found["error"] = "Сканер Bluetooth не увидел эфир."
    return found


def candidate_frames(raw):
    frames = [raw]
    for mac in (HT_MAC_REV, HT_MAC):
        index = raw.find(mac)
        if index >= 5:
            frames.append(raw[index - 5 :])
    for marker in (b"\x16\x95\xfe", b"\x95\xfe"):
        index = raw.find(marker)
        if index >= 0:
            frames.append(raw[index + len(marker) :])
    return frames


def absorb_frame(frame, ht_key, door_key, found):
    mac = frame_mac(frame)
    product = frame_product(frame)
    if ht_key and mac in (HT_MAC, HT_MAC_REV):
        found["ht_heard"] = True
        objects = decrypt_frame(frame, ht_key)
        if not objects:
            return
        found["ht_unlocked"] = True
        found["ht_objects"] = [kind for kind, _ in objects][:8]
        temperature, humidity, _ = reading_from_objects(objects)
        if temperature is not None:
            found["temperature"] = temperature
        if humidity is not None:
            found["humidity"] = humidity
    if door_key and product == 2443:
        objects = decrypt_frame(frame, door_key)
        if not objects:
            return
        _, _, door = reading_from_objects(objects)
        if door:
            found["door_heard"] = True
            found["door"] = door


def thermometer_view(scan, cached, miss, now):
    if scan is None and fresh(cached, now, "temperature"):
        return {
            "temperature": cached.get("temperature"),
            "humidity": cached.get("humidity"),
            "age_s": int(now - cached["at"]),
            "error": None,
        }
    if scan is None and fresh(miss, now, "error"):
        return {"temperature": None, "humidity": None, "age_s": int(now - miss["at"]), "error": miss.get("error")}
    if not isinstance(scan, dict):
        return {"temperature": None, "humidity": None, "age_s": None, "error": "Термометр не прочитан."}
    if scan.get("error") and scan.get("temperature") is None:
        return {"temperature": None, "humidity": None, "age_s": None, "error": scan["error"]}
    if scan.get("temperature") is None:
        if scan.get("ht_heard") and not scan.get("ht_unlocked"):
            message = "Mac услышал термометр, но объявление не расшифровалось."
        elif scan.get("ht_unlocked"):
            ids = ", ".join(str(item) for item in scan.get("ht_objects") or [])
            message = f"Температуры в объявлении нет. Объекты: {ids}." if ids else "Температуры в объявлении нет."
        else:
            message = "За 10 с Mac не услышал термометр. Температуру не подставляю."
        return {"temperature": None, "humidity": None, "age_s": None, "error": message}
    return {
        "temperature": scan.get("temperature"),
        "humidity": scan.get("humidity"),
        "age_s": 0,
        "error": None,
    }


def door_view(scan, cached, now):
    if scan is None and fresh(cached, now, "door") and isinstance(cached.get("door"), str):
        return {"value": cached["door"], "age_s": int(now - cached["at"]), "error": None}
    if not isinstance(scan, dict):
        return {
            "value": None,
            "age_s": None,
            "error": "Дверь в этом опросе не слушалась. Эфир проверяется вместе с термометром.",
        }
    if isinstance(scan.get("door"), str):
        return {"value": scan["door"], "age_s": 0, "error": None}
    if scan.get("error") in (
        "macOS не дал этому процессу доступ к Bluetooth.",
        "Bluetooth на Mac выключен.",
        "Bluetooth на этом Mac недоступен.",
        "На этом Mac не собрался сканер Bluetooth.",
        "В локальном файле нет ключа BLE.",
        "Сканер Bluetooth не запустился.",
        "Сканер Bluetooth не закончил вовремя.",
    ):
        return {"value": None, "age_s": None, "error": scan["error"]}
    return {
        "value": None,
        "age_s": None,
        "error": "За 10 с Mac не услышал датчик двери. Открыто или закрыто не подставляю.",
    }


def collect_status():
    devices = load_devices()
    try:
        remember_thermometer_mac(devices)
    except OSError:
        pass
    now = time.time()
    cached = load_reading()
    ht_cached = cached.get("ht") if isinstance(cached.get("ht"), dict) else None
    door_cached = cached.get("door") if isinstance(cached.get("door"), dict) else None
    ht_miss = cached.get("ht_miss") if isinstance(cached.get("ht_miss"), dict) else None
    door_miss = cached.get("door_miss") if isinstance(cached.get("door_miss"), dict) else None
    need_scan = not fresh(ht_cached, now, "temperature") and not fresh(ht_miss, now, "error")
    plug_records = [(spec, by_ip(devices, spec["ip"])) for spec in PLUGS]
    vacuum_record = by_ip(devices, VACUUM_IP)
    hub_record = by_ip(devices, HUB_IP)
    with ThreadPoolExecutor(max_workers=5) as pool:
        plug_jobs = []
        for spec, record in plug_records:
            if record is None:
                plug_jobs.append(None)
            else:
                plug_jobs.append(pool.submit(read_plug, record, spec["id"]))
        vacuum_job = pool.submit(read_vacuum, vacuum_record) if vacuum_record else None
        hub_job = pool.submit(read_hub, hub_record) if hub_record else None
        scan_job = None
        if need_scan:
            scan_job = pool.submit(scan_ble, ble_key(by_did(devices, HT_DID)), ble_key(by_did(devices, DOOR_DID)))
        plugs = []
        for spec, record, job in zip(PLUGS, [item[1] for item in plug_records], plug_jobs):
            if job is None:
                plugs.append({
                    "id": spec["id"],
                    "name": spec["id"],
                    "on": None,
                    "power_w": None,
                    "error": "В локальном файле нет токена этой розетки.",
                })
                continue
            try:
                plugs.append(job.result())
            except Exception:
                plugs.append({"id": spec["id"], "name": spec["id"], "on": None, "power_w": None, "error": "Розетка не ответила."})
        if vacuum_job is None:
            vacuum = {"name": "Robot Vacuum S40", "mode": "unknown", "label": "Нет статуса", "status": None, "battery": None, "charging": None, "error": "В локальном файле нет токена пылесоса."}
        else:
            try:
                vacuum = vacuum_job.result()
            except Exception:
                vacuum = {"name": "Robot Vacuum S40", "mode": "unknown", "label": "Нет статуса", "status": None, "battery": None, "charging": None, "error": "Пылесос не ответил."}
        if hub_job is None:
            hub = {"online": False, "firmware": None, "children": [], "error": "В локальном файле нет токена хаба."}
        else:
            try:
                hub = hub_job.result()
            except Exception:
                hub = {"online": False, "firmware": None, "children": [], "error": "Хаб не ответил по miIO."}
        scan = None
        if scan_job is not None:
            try:
                scan = scan_job.result()
            except Exception:
                scan = {"error": "Сканер Bluetooth не запустился.", "temperature": None, "humidity": None, "door": None}
    thermometer = thermometer_view(scan, ht_cached, ht_miss, now)
    door = door_view(scan if need_scan else None, door_cached, now)
    if not need_scan and door.get("value") is None and fresh(door_miss, now, "error"):
        door = {"value": None, "age_s": int(now - door_miss["at"]), "error": door_miss.get("error")}
    if scan is not None:
        stored = {}
        if thermometer.get("temperature") is not None and thermometer.get("age_s") == 0:
            stored["ht"] = {
                "temperature": thermometer["temperature"],
                "humidity": thermometer.get("humidity"),
                "at": now,
            }
        elif isinstance(thermometer.get("error"), str):
            stored["ht_miss"] = {"error": thermometer["error"], "at": now}
        if isinstance(scan.get("door"), str):
            stored["door"] = {"door": scan["door"], "at": now}
        elif isinstance(door.get("error"), str):
            stored["door_miss"] = {"error": door["error"], "at": now}
        if stored:
            try:
                save_reading(stored)
            except OSError:
                pass
    public_hub = {"online": hub.get("online"), "firmware": hub.get("firmware"), "error": hub.get("error")}
    return {
        "ok": True,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "plugs": plugs,
        "vacuum": vacuum,
        "thermometer": thermometer,
        "door": door,
        "motion": zigbee_view(hub, MOTION_DID),
        "button": zigbee_view(hub, BUTTON_DID),
        "hub": public_hub,
    }


def set_plug(devices, plug_id, turn_on):
    spec = next(item for item in PLUGS if item["id"] == plug_id)
    record = by_ip(devices, spec["ip"])
    if record is None:
        return {"ok": False, "error": "В локальном файле нет токена этой розетки.", "plug": {"id": plug_id, "on": None, "power_w": None, "error": "В локальном файле нет токена этой розетки."}}
    parsed = call(record, "set_properties", [{"did": record.get("did") or plug_id, "siid": 2, "piid": 1, "value": bool(turn_on)}])
    time.sleep(0.45)
    reading = read_plug(record, plug_id)
    if not accepted(parsed):
        code = result_code(parsed)
        detail = f"Розетка не приняла команду (код {code})." if isinstance(code, int) else "Розетка не приняла команду."
        return {"ok": False, "error": detail, "plug": reading}
    if reading.get("on") is not bool(turn_on):
        return {"ok": False, "error": "Розетка не подтвердила новое состояние.", "plug": reading}
    return {"ok": True, "error": None, "plug": reading}


def set_vacuum(devices, action):
    record = by_ip(devices, VACUUM_IP)
    if record is None:
        return {"ok": False, "error": "В локальном файле нет токена пылесоса.", "vacuum": {"mode": "unknown", "label": "Нет статуса", "battery": None, "error": "В локальном файле нет токена пылесоса."}}
    commands = {"start": (2, 1), "pause": (2, 7), "dock": (3, 1)}
    siid, aiid = commands[action]
    did = record.get("did") or "vacuum"
    parsed = call(record, "action", {"did": did, "siid": siid, "aiid": aiid, "in": []}, timeout=6)
    if action == "dock" and not accepted(parsed) and result_code(parsed) in (-4003, -9999):
        parsed = call(record, "action", {"did": did, "siid": 2, "aiid": 3, "in": []}, timeout=6)
    time.sleep(0.4)
    reading = read_vacuum(record)
    if not accepted(parsed):
        code = result_code(parsed)
        detail = f"Пылесос не принял команду (код {code})." if isinstance(code, int) else "Пылесос не принял команду."
        return {"ok": False, "error": detail, "vacuum": reading}
    return {"ok": True, "error": None, "vacuum": reading}


def perform(body):
    if not isinstance(body, dict):
        return {"ok": False, "error": "Не разобрал команду."}
    target = body.get("target")
    action = body.get("action")
    devices = load_devices()
    if target in ("plug-1", "plug-2") and action in ("on", "off"):
        return set_plug(devices, target, action == "on")
    if target == "vacuum" and action in ("start", "pause", "dock"):
        return set_vacuum(devices, action)
    return {"ok": False, "error": "Такой команды нет."}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "selftest":
        emit({"ok": beacon_selftest()})
        return
    if command == "status":
        emit(collect_status())
        return
    if command == "action":
        raw = sys.stdin.read()
        try:
            body = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            emit({"ok": False, "error": "Не разобрал команду."})
            return
        emit(perform(body))
        return
    emit({"ok": False, "error": "Неизвестная команда."})


if __name__ == "__main__":
    main()
