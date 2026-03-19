from __future__ import annotations

import os
import sys
import time

from sensync2_plugin_kit.ipc_worker import WorkerMethodRegistry, run_worker_loop


def echo(payload: bytes) -> bytes:
    return payload


def slow_echo(payload: bytes) -> bytes:
    time.sleep(0.2)
    return payload


def crash(_: bytes) -> bytes:
    raise RuntimeError("boom")


def exit_process(_: bytes) -> bytes:
    raise SystemExit(17)


if __name__ == "__main__":
    run_worker_loop(
        WorkerMethodRegistry(
            worker_version="test-worker",
            protocol_version=int(os.environ.get("SENSYNC2_TEST_PROTOCOL_VERSION", "1")),
            methods={
                "test.echo": echo,
                "test.slow": slow_echo,
                "test.crash": crash,
                "test.exit": exit_process,
            },
        ),
    )
