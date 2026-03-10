#!/usr/bin/env python3
"""Конвертирует HDF5 запись в replay-bundle для `sensync2`.

Формат bundle:
- manifest.json
- streams/<stream_id_sanitized>.f64bin (интерлив `timestamp,value` в float64 little-endian)
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any

import h5py
import numpy as np

EXCLUDED_STREAMS = {
    "trigno.avanti.envelope",
}
# Исторические HDF5 записи от текущего Python runtime хранят timestamp в секундах.
# Для `sensync2` replay приводим их к миллисекундам.
TIMESTAMP_SCALE_TO_MS = 1000.0


def sanitize_stream_id(stream_id: str) -> str:
    """Безопасное имя файла для stream id."""
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", stream_id)
    return safe.strip("._") or "stream"


def infer_stream_meta(stream_id: str) -> tuple[str, str]:
    """Определяет sampleFormat и frameKind для stream.

    Для `label` потоков используем `i16 + label-batch`, для остальных `f64 + irregular`.
    """
    if stream_id in {"lactate.label", "trigno.avanti.activity"}:
        return "i16", "label-batch"
    return "f64", "irregular-signal-batch"


def convert_h5_to_bundle(input_path: Path, output_dir: Path) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Файл не найден: {input_path}")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    streams_dir = output_dir / "streams"
    streams_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "version": 1,
        "format": "sensync2.replay.bundle.v1",
        "timeDomain": "session",
        "sourceTimestampUnit": "seconds",
        "targetTimestampUnit": "milliseconds",
        "sourceFile": str(input_path),
        "streams": [],
        "stats": {
            "streamCount": 0,
            "totalSamples": 0,
            "minTimestampMs": None,
            "maxTimestampMs": None,
        },
    }

    with h5py.File(input_path, "r") as h5:
        stream_names = sorted(list(h5.keys()))
        for stream_id in stream_names:
            if stream_id in EXCLUDED_STREAMS:
                print(f"⏭️ Пропускаю {stream_id}: исключен из replay-профиля")
                continue
            ds = h5[stream_id]
            arr = np.asarray(ds[:], dtype=np.float64)
            if arr.ndim != 2 or (arr.shape[1] if arr.size else 2) != 2:
                print(f"⚠️ Пропускаю {stream_id}: ожидается форма (N,2), получено {arr.shape}")
                continue
            if arr.shape[0] == 0:
                print(f"⚠️ Пропускаю {stream_id}: пустой датасет")
                continue

            sample_format, frame_kind = infer_stream_meta(stream_id)
            safe_name = sanitize_stream_id(stream_id)
            data_file = f"streams/{safe_name}.f64bin"
            data_path = output_dir / data_file
            # Храним данные как float64 interleaved: [ts0, v0, ts1, v1, ...]
            arr_ms = np.empty_like(arr)
            arr_ms[:, 0] = arr[:, 0] * TIMESTAMP_SCALE_TO_MS
            arr_ms[:, 1] = arr[:, 1]
            arr_ms.astype("<f8", copy=False).tofile(data_path)

            timestamps = arr_ms[:, 0]
            values = arr_ms[:, 1]
            sample_count = int(arr.shape[0])
            min_ts = float(timestamps[0])
            max_ts = float(timestamps[-1])

            stream_meta: dict[str, Any] = {
                "streamId": stream_id,
                "channelId": stream_id,
                "sampleFormat": sample_format,
                "frameKind": frame_kind,
                "sampleCount": sample_count,
                "dataFile": data_file,
                "minTimestampMs": min_ts,
                "maxTimestampMs": max_ts,
                "valueMin": float(np.min(values)),
                "valueMax": float(np.max(values)),
            }

            if "units" in ds.attrs:
                units = ds.attrs["units"]
                stream_meta["units"] = str(units.decode() if isinstance(units, bytes) else units)

            manifest["streams"].append(stream_meta)
            manifest["stats"]["streamCount"] += 1
            manifest["stats"]["totalSamples"] += sample_count

            if manifest["stats"]["minTimestampMs"] is None or min_ts < manifest["stats"]["minTimestampMs"]:
                manifest["stats"]["minTimestampMs"] = min_ts
            if manifest["stats"]["maxTimestampMs"] is None or max_ts > manifest["stats"]["maxTimestampMs"]:
                manifest["stats"]["maxTimestampMs"] = max_ts

            print(
                f"✓ {stream_id}: n={sample_count} ts=[{min_ts:.3f}, {max_ts:.3f}] "
                f"kind={frame_kind} format={sample_format}"
            )

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ Готово: {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Конвертер HDF5 -> sensync2 replay bundle")
    parser.add_argument("input", type=Path, help="Путь к HDF5 файлу")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("test.replay"),
        help="Директория bundle (по умолчанию: ./test.replay)",
    )
    args = parser.parse_args()

    convert_h5_to_bundle(args.input, args.output)


if __name__ == "__main__":
    main()
