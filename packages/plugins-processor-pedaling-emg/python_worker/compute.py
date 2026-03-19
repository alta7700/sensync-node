from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal


@dataclass(slots=True)
class DetectionResult:
    status: str
    confidence: float
    baseline: float
    threshold_high: float
    threshold_low: float
    onset_offset_ms: float | None = None
    offset_offset_ms: float | None = None


def _clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value


def _moving_average(values: np.ndarray, window_samples: int) -> np.ndarray:
    if window_samples <= 1:
        return values.copy()
    kernel = np.ones(window_samples, dtype=np.float64) / float(window_samples)
    return np.convolve(values, kernel, mode="same")


def _moving_rms(values: np.ndarray, window_samples: int) -> np.ndarray:
    squared = np.square(values, dtype=np.float64)
    averaged = _moving_average(squared, window_samples)
    return np.sqrt(np.maximum(averaged, 0.0))


def _stable_duration_samples(sample_rate_hz: float, duration_ms: float) -> int:
    return max(1, int(round((sample_rate_hz * duration_ms) / 1000.0)))


def _find_onset_and_offset(
    envelope: np.ndarray,
    sample_rate_hz: float,
    expected_start_index: int,
    expected_end_index: int,
    threshold_high: float,
    threshold_low: float,
) -> tuple[int | None, int | None]:
    min_active_samples = _stable_duration_samples(sample_rate_hz, 40.0)
    min_quiet_samples = _stable_duration_samples(sample_rate_hz, 35.0)
    search_start = max(0, expected_start_index)
    search_end = min(len(envelope), expected_end_index)

    if search_end <= search_start:
        return (None, None)

    onset_index: int | None = None
    for index in range(search_start, max(search_end - min_active_samples + 1, search_start)):
        window = envelope[index:index + min_active_samples]
        if np.all(window >= threshold_high):
            onset_index = index
            while onset_index > search_start and envelope[onset_index - 1] >= threshold_low:
                onset_index -= 1
            break

    if onset_index is None:
        return (None, None)

    offset_index: int | None = None
    quiet_from = min(search_end, onset_index + min_active_samples)
    for index in range(quiet_from, max(search_end - min_quiet_samples + 1, quiet_from)):
        window = envelope[index:index + min_quiet_samples]
        if np.all(window < threshold_low):
            offset_index = index
            break

    if offset_index is None:
        offset_index = search_end - 1

    return (onset_index, offset_index)


def analyze_emg_segment(
    emg_samples: np.ndarray,
    sample_rate_hz: float,
    expected_active_start_offset_ms: float,
    expected_active_end_offset_ms: float,
    previous_baseline: float | None = None,
    previous_threshold_high: float | None = None,
    previous_threshold_low: float | None = None,
) -> DetectionResult:
    """Ищет onset/offset по короткому EMG-сегменту внутри ожидаемого фазового окна."""
    if sample_rate_hz <= 0 or len(emg_samples) < max(16, int(sample_rate_hz * 0.1)):
        return DetectionResult(
            status="invalid_window",
            confidence=0.0,
            baseline=0.0,
            threshold_high=0.0,
            threshold_low=0.0,
        )

    nyquist_hz = sample_rate_hz / 2.0
    high_cut_hz = min(450.0, nyquist_hz * 0.9)
    low_cut_hz = min(20.0, high_cut_hz * 0.5)
    if high_cut_hz <= low_cut_hz:
        return DetectionResult(
            status="invalid_window",
            confidence=0.0,
            baseline=0.0,
            threshold_high=0.0,
            threshold_low=0.0,
        )

    expected_start_index = int(round((expected_active_start_offset_ms / 1000.0) * sample_rate_hz))
    expected_end_index = int(round((expected_active_end_offset_ms / 1000.0) * sample_rate_hz))

    if expected_end_index <= expected_start_index:
        return DetectionResult(
            status="invalid_window",
            confidence=0.0,
            baseline=0.0,
            threshold_high=0.0,
            threshold_low=0.0,
        )

    search_start = max(0, expected_start_index)
    search_end = min(len(emg_samples), expected_end_index)
    if search_end <= search_start:
        return DetectionResult(
            status="invalid_window",
            confidence=0.0,
            baseline=0.0,
            threshold_high=0.0,
            threshold_low=0.0,
        )

    sos = signal.butter(4, [low_cut_hz, high_cut_hz], btype="bandpass", output="sos", fs=sample_rate_hz)
    filtered = signal.sosfiltfilt(sos, emg_samples.astype(np.float64))
    envelope = _moving_rms(filtered, _stable_duration_samples(sample_rate_hz, 35.0))

    outside_mask = np.ones(len(envelope), dtype=bool)
    outside_mask[search_start:search_end] = False
    outside_window = envelope[outside_mask]
    baseline_source = outside_window if outside_window.size >= 8 else envelope
    baseline = float(np.percentile(baseline_source, 25))
    noise_sigma = float(np.std(baseline_source))

    if previous_baseline is not None:
        baseline = float((baseline * 0.7) + (previous_baseline * 0.3))

    peak_in_window = float(np.max(envelope[search_start:search_end]))
    threshold_high = baseline + max(noise_sigma * 2.5, (peak_in_window - baseline) * 0.25)
    if previous_threshold_high is not None:
        threshold_high = float((threshold_high * 0.7) + (previous_threshold_high * 0.3))

    threshold_low = baseline + ((threshold_high - baseline) * 0.6)
    if previous_threshold_low is not None:
        threshold_low = float((threshold_low * 0.7) + (previous_threshold_low * 0.3))

    if peak_in_window <= threshold_high:
        return DetectionResult(
            status="low_snr",
            confidence=0.0,
            baseline=baseline,
            threshold_high=threshold_high,
            threshold_low=threshold_low,
        )

    onset_index, offset_index = _find_onset_and_offset(
        envelope=envelope,
        sample_rate_hz=sample_rate_hz,
        expected_start_index=expected_start_index,
        expected_end_index=expected_end_index,
        threshold_high=threshold_high,
        threshold_low=threshold_low,
    )

    if onset_index is None or offset_index is None or offset_index <= onset_index:
        return DetectionResult(
            status="no_activation",
            confidence=0.0,
            baseline=baseline,
            threshold_high=threshold_high,
            threshold_low=threshold_low,
        )

    duration_samples = offset_index - onset_index
    min_active_samples = _stable_duration_samples(sample_rate_hz, 40.0)
    duration_confidence = _clamp01(duration_samples / max(min_active_samples, 1))
    snr_confidence = _clamp01((peak_in_window - threshold_high) / max(threshold_high - baseline, 1e-6))
    confidence = float(_clamp01((snr_confidence * 0.7) + (duration_confidence * 0.3)))

    return DetectionResult(
        status="ok",
        confidence=confidence,
        baseline=baseline,
        threshold_high=threshold_high,
        threshold_low=threshold_low,
        onset_offset_ms=(onset_index / sample_rate_hz) * 1000.0,
        offset_offset_ms=(offset_index / sample_rate_hz) * 1000.0,
    )
