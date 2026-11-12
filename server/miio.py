"""Minimal local miIO client. Tokens stay with the caller and are never logged."""

import binascii
import hashlib
import json
import socket
import struct
import time

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad


class MiIO:
    def __init__(self, ip, token, timeout=4.0, tries=3):
        self.ip = ip
        self.token = binascii.unhexlify(token)
        self.key = hashlib.md5(self.token).digest()
        self.iv = hashlib.md5(self.key + self.token).digest()
        self.timeout = timeout
        self.tries = tries
        self.device_id = None
        self.delta = None

    def _handshake(self, sock):
        packet = struct.pack(
            ">HHIII16s",
            0x2131,
            32,
            0xFFFFFFFF,
            0xFFFFFFFF,
            int(time.time()),
            b"\xff" * 16,
        )
        sock.sendto(packet, (self.ip, 54321))
        data, _ = sock.recvfrom(4096)
        if data[:2] != b"\x21\x31":
            return False
        self.device_id = struct.unpack(">I", data[8:12])[0]
        stamp = struct.unpack(">I", data[12:16])[0]
        self.delta = time.time() - stamp
        return True

    def send(self, method, params=None):
        last = "offline"
        for attempt in range(self.tries):
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(self.timeout)
            try:
                if self.device_id is None or self.delta is None:
                    if not self._handshake(sock):
                        last = "protocol"
                        continue
                msg_id = int(time.time() * 1000) % 100000000 + attempt
                payload = json.dumps(
                    {
                        "id": msg_id,
                        "method": method,
                        "params": [] if params is None else params,
                    },
                    separators=(",", ":"),
                ).encode() + b"\x00"
                encrypted = AES.new(self.key, AES.MODE_CBC, self.iv).encrypt(pad(payload, 16))
                header = struct.pack(
                    ">HHIII",
                    0x2131,
                    32 + len(encrypted),
                    0,
                    self.device_id,
                    int(time.time() - self.delta),
                )
                checksum = hashlib.md5(header + self.token + encrypted).digest()
                sock.sendto(header + checksum + encrypted, (self.ip, 54321))
                data, _ = sock.recvfrom(65535)
                decrypted = unpad(
                    AES.new(self.key, AES.MODE_CBC, self.iv).decrypt(data[32:]),
                    16,
                ).rstrip(b"\x00")
                if not decrypted:
                    return {"result": None}
                parsed = json.loads(decrypted)
                if parsed.get("id") != msg_id:
                    last = "protocol"
                    self.device_id = None
                    continue
                return parsed
            except socket.timeout:
                last = "timeout"
                self.device_id = None
            except (OSError, ValueError, json.JSONDecodeError, KeyError):
                last = "protocol"
                self.device_id = None
            finally:
                sock.close()
        return {"error": last}
