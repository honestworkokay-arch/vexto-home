#!/usr/bin/env python3
"""Read the owner's Hub 2 key through its documented feedback-log command."""

import base64
import io
import json
import os
import re
import socket
import sys
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from miio import MiIO  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HUB_IP = "192.168.0.208"
KEY_FILE = Path(__file__).resolve().parent / ".gateway-key"


def local_address(remote):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.connect((remote, 54321))
        return connection.getsockname()[0]


def main():
    devices = json.loads((ROOT / ".xiaomi-devices.json").read_text())
    hub = next((item for item in devices if item.get("ip") == HUB_IP), None)
    if not hub or not hub.get("token"):
        raise RuntimeError("В локальном кеше нет токена Hub 2.")

    client = MiIO(HUB_IP, hub["token"], timeout=6, tries=1)
    info = client.send("miIO.info", [])
    if info.get("result", {}).get("model") != "lumi.gateway.mgl001":
        raise RuntimeError("Ответил не ожидаемый Hub 2.")

    uploads = []

    class Receiver(BaseHTTPRequestHandler):
        def do_PUT(self):
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2_000_000:
                self.send_error(413)
                return
            uploads.append(self.rfile.read(length))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            pass

    host = local_address(HUB_IP)
    httpd = HTTPServer((host, 0), Receiver)
    httpd.timeout = 35
    worker = threading.Thread(target=httpd.handle_request, daemon=True)
    worker.start()
    key = os.urandom(16)
    iv = os.urandom(16)
    try:
        reply = client.send("async_device_feedback_log", {
            "encryptKey": base64.urlsafe_b64encode(key).decode(),
            "iv": base64.urlsafe_b64encode(iv).decode(),
            "url": f"http://{host}:{httpd.server_port}/",
            "fileList": [],
            "filelist": ["/data/miio/device.conf"],
        })
        if reply.get("result") != ["ok"]:
            raise RuntimeError("Hub 2 не принял запрос локального журнала.")
        worker.join(36)
    finally:
        httpd.server_close()
    if not uploads:
        raise RuntimeError("Hub 2 не доставил журнал на Mac за 35 секунд.")

    raw = unpad(AES.new(key, AES.MODE_CBC, iv).decrypt(uploads[0]), 16)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        contents = archive.extractfile(archive.getmembers()[0]).read().decode()
    values = dict(re.findall(r"(did|key|mac|model)=(\S+)", contents))
    if values.get("model") != "lumi.gateway.mgl001" or len(values.get("key", "")) != 16:
        raise RuntimeError("В журнале не найден корректный ключ Hub 2.")
    KEY_FILE.write_text(values["key"])
    KEY_FILE.chmod(0o600)
    print("Ключ Hub 2 прочитан и сохранён локально; в вывод не попал.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, tarfile.TarError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
