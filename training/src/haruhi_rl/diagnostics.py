"""对训练指标做保守、可解释的滚动健康诊断。"""

from __future__ import annotations

import math
from typing import Any, Sequence


def _finite_values(records: Sequence[dict[str, Any]], key: str) -> list[float]:
    values: list[float] = []
    for record in records:
        value = record.get(key)
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            values.append(float(value))
    return values


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def analyze_training_metrics(
    records: Sequence[dict[str, Any]],
    *,
    window: int = 10,
    target_kl: float = 0.03,
) -> dict[str, Any]:
    if window < 3:
        raise ValueError("诊断窗口至少为 3 次更新")
    signals: list[dict[str, Any]] = []
    malformed = []
    for index, record in enumerate(records):
        for key, value in record.items():
            if isinstance(value, float) and not math.isfinite(value):
                malformed.append({"record": index, "key": key, "value": repr(value)})
    if malformed:
        signals.append({
            "severity": "critical",
            "code": "non_finite_metrics",
            "message": "训练指标出现 NaN 或无穷值",
            "samples": malformed[:10],
        })

    updates = [int(value) for value in _finite_values(records, "update")]
    if any(right <= left for left, right in zip(updates, updates[1:])):
        signals.append({
            "severity": "critical",
            "code": "non_monotonic_updates",
            "message": "训练更新编号未严格递增，可能发生错误续训或指标串接",
        })

    if len(records) < window:
        signals.append({
            "severity": "info",
            "code": "insufficient_history",
            "message": f"只有 {len(records)} 次更新，至少 {window} 次后才判断趋势",
        })
        return {
            "verdict": "critical" if malformed else "insufficient_history",
            "updates": len(records),
            "window": window,
            "signals": signals,
        }

    recent = records[-window:]
    completion = _mean(_finite_values(recent, "natural_completion_rate"))
    seat_a = _mean(_finite_values(recent, "seat_a_win_rate"))
    approx_kl = _mean(_finite_values(recent, "approx_kl"))
    early_stop = _mean(_finite_values(recent, "early_stop"))
    value_loss = _mean(_finite_values(recent, "value_loss"))
    grad_norm = _mean(_finite_values(recent, "grad_norm"))
    recent_entropy = _mean(_finite_values(recent, "entropy"))
    baseline_entropy = _mean(_finite_values(records[:window], "entropy"))

    if completion is not None and completion < 0.9:
        signals.append({
            "severity": "warning",
            "code": "excessive_timeouts",
            "message": f"最近窗口自然结束率仅 {completion:.1%}",
        })
    if seat_a is not None and abs(seat_a - 0.5) > 0.2:
        signals.append({
            "severity": "warning" if abs(seat_a - 0.5) <= 0.3 else "critical",
            "code": "seat_bias",
            "message": f"最近窗口 A 席胜率为 {seat_a:.1%}，存在明显席位偏差",
        })
    if approx_kl is not None and approx_kl > target_kl * 2:
        signals.append({
            "severity": "critical",
            "code": "kl_overshoot",
            "message": f"平均近似 KL {approx_kl:.4f} 超过目标值两倍",
        })
    elif early_stop is not None and early_stop > 0.75:
        signals.append({
            "severity": "warning",
            "code": "frequent_kl_early_stop",
            "message": f"最近窗口 {early_stop:.1%} 的更新因 KL 提前停止",
        })
    if value_loss is not None and value_loss > 5:
        signals.append({
            "severity": "critical",
            "code": "value_loss_explosion",
            "message": f"终局回报范围内价值损失异常升至 {value_loss:.3f}",
        })
    if grad_norm is not None and grad_norm < 1e-8:
        signals.append({
            "severity": "critical",
            "code": "inactive_gradients",
            "message": "最近窗口梯度范数接近零，策略可能已断开计算图",
        })
    if (
        baseline_entropy is not None
        and baseline_entropy > 0
        and recent_entropy is not None
        and recent_entropy < baseline_entropy * 0.2
    ):
        signals.append({
            "severity": "warning",
            "code": "entropy_collapse",
            "message": (
                f"策略熵由初始窗口均值 {baseline_entropy:.3f} "
                f"降至 {recent_entropy:.3f}"
            ),
        })

    severities = {signal["severity"] for signal in signals}
    verdict = "critical" if "critical" in severities else "watch" if "warning" in severities else "ok"
    return {
        "verdict": verdict,
        "updates": len(records),
        "window": window,
        "recent": {
            "natural_completion_rate": completion,
            "seat_a_win_rate": seat_a,
            "approx_kl": approx_kl,
            "early_stop_rate": early_stop,
            "value_loss": value_loss,
            "grad_norm": grad_norm,
            "entropy": recent_entropy,
        },
        "signals": signals,
    }
