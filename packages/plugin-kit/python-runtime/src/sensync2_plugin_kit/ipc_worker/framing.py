from __future__ import annotations

import struct
from typing import BinaryIO


def read_frame(stream: BinaryIO) -> bytes | None:
    """Читает один length-prefixed frame из бинарного потока."""
    header = stream.read(4)
    if header == b"":
        return None
    if len(header) != 4:
        raise RuntimeError("Неполный frame header в IPC worker")

    frame_len = struct.unpack("<I", header)[0]
    if frame_len == 0:
        return b""

    payload = stream.read(frame_len)
    if len(payload) != frame_len:
        raise RuntimeError("Неполный frame payload в IPC worker")
    return payload


def write_frame(stream: BinaryIO, payload: bytes) -> None:
    """Пишет один length-prefixed frame в бинарный поток."""
    stream.write(struct.pack("<I", len(payload)))
    stream.write(payload)
    stream.flush()
