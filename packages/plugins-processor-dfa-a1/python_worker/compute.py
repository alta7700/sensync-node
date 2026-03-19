from __future__ import annotations

from collections.abc import Sequence

import numpy as np


def dfa_alpha(
    rr_intervals_ms: Sequence[float],
    lower_scale: int = 4,
    upper_scale: int = 16,
) -> float:
    """Считает DFA alpha1 по канонической схеме Peng/PhysioNet для коротких шкал 4-16."""
    scale_density = 12
    poly_order = 1

    scales = np.unique(
        np.floor(
            np.logspace(np.log10(lower_scale), np.log10(upper_scale), scale_density),
        ).astype(int),
    )

    fluctuation = np.zeros(len(scales), dtype=np.float64)
    signal = np.asarray(rr_intervals_ms, dtype=np.float64)

    for index, scale in enumerate(scales):
        profile = np.cumsum(signal - np.mean(signal))
        n_points = len(signal)
        n_segments = int(np.floor(n_points / scale))
        segment_size = int(scale) * n_segments

        segments_forward = np.reshape(
            profile[:segment_size],
            (int(scale), n_segments),
            order="F",
        ).T
        segments_backward = np.reshape(
            profile[-segment_size:],
            (int(scale), n_segments),
            order="F",
        ).T
        all_segments = np.vstack((segments_forward, segments_backward))

        rms_values: list[float] = []
        x_axis = np.arange(int(scale))

        for segment in all_segments:
            coeffs = np.polyfit(x_axis, segment, poly_order)
            trend = np.polyval(coeffs, x_axis)
            residuals = segment - trend
            rms_values.append(float(np.sqrt(np.mean(residuals ** 2))))

        if rms_values:
            fluctuation[index] = np.sqrt(np.mean(np.asarray(rms_values) ** 2))

    alpha_coeffs = np.polyfit(np.log2(scales), np.log2(fluctuation), 1)
    return float(alpha_coeffs[0])
