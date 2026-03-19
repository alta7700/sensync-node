from __future__ import annotations

import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
GENERATED_ROOT = CURRENT_DIR / "generated"

if str(GENERATED_ROOT) not in sys.path:
    sys.path.insert(0, str(GENERATED_ROOT))

from sensync2_plugin_kit.ipc_worker import WorkerMethodRegistry, run_worker_loop
from sensync2_plugin_kit.ipc_worker import numeric_array_pb2
import pedaling_emg_pb2

def _read_numeric_array(array: numeric_array_pb2.NumericArray):
    import numpy as np

    if array.sample_format == numeric_array_pb2.SAMPLE_FORMAT_F32:
        return np.frombuffer(memoryview(array.data), dtype=np.float32, count=array.length).astype(np.float64)
    if array.sample_format == numeric_array_pb2.SAMPLE_FORMAT_F64:
        return np.frombuffer(memoryview(array.data), dtype=np.float64, count=array.length)
    if array.sample_format == numeric_array_pb2.SAMPLE_FORMAT_I16:
        return np.frombuffer(memoryview(array.data), dtype=np.int16, count=array.length).astype(np.float64)
    raise ValueError("pedaling-emg worker получил неподдерживаемый sampleFormat")


def compute_pedaling_emg(payload: bytes) -> bytes:
    from compute import analyze_emg_segment

    request = pedaling_emg_pb2.PedalingEmgAnalysisRequest()
    request.ParseFromString(payload)

    result = analyze_emg_segment(
        emg_samples=_read_numeric_array(request.emg_samples),
        sample_rate_hz=request.sample_rate_hz,
        expected_active_start_offset_ms=request.expected_active_start_offset_ms,
        expected_active_end_offset_ms=request.expected_active_end_offset_ms,
        previous_baseline=request.previous_baseline if request.HasField("previous_baseline") else None,
        previous_threshold_high=request.previous_threshold_high if request.HasField("previous_threshold_high") else None,
        previous_threshold_low=request.previous_threshold_low if request.HasField("previous_threshold_low") else None,
    )

    status_map = {
        "ok": pedaling_emg_pb2.PEDALING_EMG_STATUS_OK,
        "low_snr": pedaling_emg_pb2.PEDALING_EMG_STATUS_LOW_SNR,
        "no_activation": pedaling_emg_pb2.PEDALING_EMG_STATUS_NO_ACTIVATION,
        "invalid_window": pedaling_emg_pb2.PEDALING_EMG_STATUS_INVALID_WINDOW,
    }
    response = pedaling_emg_pb2.PedalingEmgAnalysisResponse(
        confidence=result.confidence,
        baseline=result.baseline,
        threshold_high=result.threshold_high,
        threshold_low=result.threshold_low,
        status=status_map[result.status],
    )
    if result.onset_offset_ms is not None:
        response.detected_onset_offset_ms = result.onset_offset_ms
    if result.offset_offset_ms is not None:
        response.detected_offset_offset_ms = result.offset_offset_ms
    return response.SerializeToString()


if __name__ == "__main__":
    run_worker_loop(
        WorkerMethodRegistry(
            worker_version="0.1.0",
            methods={
                "pedaling.emg.detect": compute_pedaling_emg,
            },
        ),
    )
