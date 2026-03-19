from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

CURRENT_DIR = Path(__file__).resolve().parent
GENERATED_ROOT = CURRENT_DIR / "generated"

if str(GENERATED_ROOT) not in sys.path:
    sys.path.insert(0, str(GENERATED_ROOT))

from sensync2_plugin_kit.ipc_worker import WorkerMethodRegistry, run_worker_loop
from sensync2_processors.dfa_a1 import dfa_a1_pb2
from sensync2_plugin_kit.ipc_worker import numeric_array_pb2

from compute import dfa_alpha


def compute_dfa(payload: bytes) -> bytes:
    request = dfa_a1_pb2.DfaA1FromRrRequest()
    request.ParseFromString(payload)

    if request.rr_intervals_ms.sample_format != numeric_array_pb2.SAMPLE_FORMAT_F64:
        raise ValueError("DFA worker ожидает rr_intervals_ms в формате F64")

    rr_view = memoryview(request.rr_intervals_ms.data)
    rr_intervals_ms = dfa_alpha(
        rr_intervals_ms=np.frombuffer(rr_view, dtype=np.float64, count=request.rr_intervals_ms.length),
        lower_scale=request.lower_scale,
        upper_scale=request.upper_scale,
    )
    response = dfa_a1_pb2.DfaA1FromRrResponse(alpha1=rr_intervals_ms)
    return response.SerializeToString()


if __name__ == "__main__":
    run_worker_loop(
        WorkerMethodRegistry(
            worker_version="0.1.0",
            methods={
                "dfa.a1.from_rr": compute_dfa,
            },
        ),
    )
