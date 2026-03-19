"""Базовый transport/runtime слой для IPC compute-worker'ов."""

from .runtime import WorkerMethod, WorkerMethodRegistry, run_worker_loop

__all__ = [
    "run_worker_loop",
    "WorkerMethodRegistry",
    "WorkerMethod",
]
