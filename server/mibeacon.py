"""Decode Xiaomi FE95 advertisements. Bind keys stay with the caller."""

import struct

from Crypto.Cipher import AES


def parse_objects(payload):
    objects = []
    offset = 0
    while offset + 3 <= len(payload):
        kind = int.from_bytes(payload[offset : offset + 2], "little")
        length = payload[offset + 2]
        start = offset + 3
        end = start + length
        if end > len(payload):
            break
        objects.append((kind, payload[start:end]))
        offset = end
    return objects


def _decrypt(frame, key, mac_at):
    if len(frame) < mac_at + 6 + 8:
        return None
    mac = frame[mac_at : mac_at + 6]
    encrypted = frame[mac_at + 6 :]
    if len(encrypted) < 8:
        return None
    nonce = mac + frame[2:5] + encrypted[-7:-4]
    try:
        cipher = AES.new(key, AES.MODE_CCM, nonce=nonce, mac_len=4)
        cipher.update(b"\x11")
        return cipher.decrypt_and_verify(encrypted[:-7], encrypted[-4:])
    except ValueError:
        return None


def decrypt_frame(frame, key):
    """Return plaintext objects, or None when the frame is not a readable MiBeacon."""
    if not isinstance(frame, (bytes, bytearray)) or len(frame) < 11 or len(key) != 16:
        return None
    frame_ctrl = int.from_bytes(frame[0:2], "little")
    if not frame_ctrl & 0x08:
        mac_at = 5 if frame_ctrl & 0x10 else None
        payload = frame[11:] if mac_at == 5 else frame[5:]
        return parse_objects(payload)
    for mac_at in (5, 6):
        plain = _decrypt(frame, key, mac_at)
        if plain:
            return parse_objects(plain)
    return None


def reading_from_objects(objects):
    """Map known object ids for the O3 thermometer and the ISA door sensor."""
    temperature = None
    humidity = None
    door = None
    for kind, blob in objects:
        if kind == 18433 and len(blob) == 4 and temperature is None:
            value = struct.unpack("<f", blob)[0]
            if -40.0 <= value <= 80.0:
                temperature = round(value, 1)
        elif kind == 18434 and blob and humidity is None:
            value = blob[0]
            if 0 <= value <= 100:
                humidity = value
        elif kind == 4121 and blob and door is None:
            flag = blob[0]
            if flag == 0:
                door = "открыто"
            elif flag == 1:
                door = "закрыто"
            elif flag == 2:
                door = "открыто слишком долго"
    return temperature, humidity, door


def frame_mac(frame):
    if len(frame) < 11:
        return b""
    frame_ctrl = int.from_bytes(frame[0:2], "little")
    if frame_ctrl & 0x10:
        return bytes(frame[5:11])
    return b""


def frame_product(frame):
    if len(frame) < 4:
        return None
    return int.from_bytes(frame[2:4], "little")


def selftest():
    packet = bytes.fromhex(
        "043e2b020103000fc4e044ef541f0201061b1695fe58598d0a170fc4e044ef547cc27a5c03a1000000790df258bb"
    )
    key = bytes.fromhex("FDD8CE9C08AE7533A79BDAF0BB755E96")
    index = packet.find(b"\x16\x95\xfe")
    frame = packet[index + 3 : -1]
    plain = decrypt_frame(frame, key)
    if not plain or plain[0][0] != 0x000F:
        return False
    sample = parse_objects(struct.pack("<HB", 18433, 4) + struct.pack("<f", 23.0))
    temperature, _, _ = reading_from_objects(sample)
    return temperature == 23.0
