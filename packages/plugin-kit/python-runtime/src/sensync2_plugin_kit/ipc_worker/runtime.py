from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

from .framing import read_frame, write_frame
from . import transport_pb2


WorkerMethod = Callable[[bytes], bytes]


@dataclass(slots=True)
class WorkerMethodRegistry:
    worker_version: str
    methods: dict[str, WorkerMethod]
    protocol_version: int = 1


def _encode_envelope(envelope: transport_pb2.Envelope) -> bytes:
    return envelope.SerializeToString()


def _emit_ready(registry: WorkerMethodRegistry) -> None:
    envelope = transport_pb2.Envelope(
        ready=transport_pb2.Ready(
            protocol_version=registry.protocol_version,
            worker_version=registry.worker_version,
            methods=sorted(registry.methods.keys()),
        ),
    )
    write_frame(sys.stdout.buffer, _encode_envelope(envelope))


def _emit_error(request_id: str, code: str, message: str) -> None:
    envelope = transport_pb2.Envelope(
        response=transport_pb2.Response(
            request_id=request_id,
            ok=False,
            error=transport_pb2.WorkerError(code=code, message=message),
        ),
    )
    write_frame(sys.stdout.buffer, _encode_envelope(envelope))


def _emit_response(request_id: str, payload: bytes) -> None:
    envelope = transport_pb2.Envelope(
        response=transport_pb2.Response(
            request_id=request_id,
            ok=True,
            payload=payload,
        ),
    )
    write_frame(sys.stdout.buffer, _encode_envelope(envelope))


def run_worker_loop(registry: WorkerMethodRegistry) -> None:
    """Запускает стандартный request/response loop для compute-worker'а."""
    _emit_ready(registry)

    while True:
        frame = read_frame(sys.stdin.buffer)
        if frame is None:
            return

        envelope = transport_pb2.Envelope()
        envelope.ParseFromString(frame)
        payload_kind = envelope.WhichOneof("payload")

        if payload_kind == "shutdown":
            return
        if payload_kind != "request":
            raise RuntimeError(f"Неожиданное transport-сообщение: {payload_kind}")

        request = envelope.request
        method = registry.methods.get(request.method)
        if method is None:
            _emit_error(request.request_id, "method_not_found", f"Метод {request.method} не зарегистрирован")
            continue

        try:
            response_payload = method(bytes(request.payload))
        except Exception as error:
            _emit_error(request.request_id, "worker_method_failed", str(error))
            continue

        _emit_response(request.request_id, response_payload)
