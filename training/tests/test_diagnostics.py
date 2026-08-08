from __future__ import annotations

from haruhi_rl.diagnostics import analyze_training_metrics


def healthy_record(update: int) -> dict[str, float]:
    return {
        "update": float(update),
        "natural_completion_rate": 1,
        "seat_a_win_rate": 0.5,
        "approx_kl": 0.01,
        "early_stop": 0,
        "value_loss": 0.4,
        "grad_norm": 0.5,
        "entropy": 8,
    }


def test_short_history_does_not_raise_trend_alarm() -> None:
    result = analyze_training_metrics([healthy_record(1), healthy_record(2)])
    assert result["verdict"] == "insufficient_history"
    assert result["signals"][0]["code"] == "insufficient_history"


def test_healthy_window_is_ok() -> None:
    result = analyze_training_metrics([healthy_record(index) for index in range(1, 21)])
    assert result["verdict"] == "ok"
    assert result["signals"] == []


def test_collapsed_and_biased_window_is_reported() -> None:
    records = [healthy_record(index) for index in range(1, 11)]
    for index in range(11, 21):
        record = healthy_record(index)
        record.update({
            "natural_completion_rate": 0.5,
            "seat_a_win_rate": 0.95,
            "approx_kl": 0.08,
            "value_loss": 8,
            "grad_norm": 0,
            "entropy": 0.5,
        })
        records.append(record)
    result = analyze_training_metrics(records)
    codes = {signal["code"] for signal in result["signals"]}
    assert result["verdict"] == "critical"
    assert {
        "excessive_timeouts",
        "seat_bias",
        "kl_overshoot",
        "value_loss_explosion",
        "inactive_gradients",
        "entropy_collapse",
    } <= codes
