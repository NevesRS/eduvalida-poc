#!/usr/bin/env python3
"""Gráficos de barra comparando ERC-6909 vs ERC-1155 (Caliper/Besu).

- Se caliper/results-summary.csv existir, usa média ± desvio amostral (barras de erro).
- Caso contrário, cai para results.csv + results-v1.csv (n=1, sem barras de erro).

Sai 4 PNGs em caliper/charts/: throughput e latência, separados em writes e views
(escala muito diferente: ~100 TPS views vs ~5-18 TPS writes).
"""
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

CALIPER = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(CALIPER, "charts")
COLORS = {"ERC-6909": "#2563eb", "ERC-1155": "#f59e0b"}
CONTRACTS = ["ERC-6909", "ERC-1155"]


def short_label(method: str) -> str:
    if method.startswith("throughput"):
        return "max-rate"
    return method.split(" (")[0]


def load_wide() -> tuple[pd.DataFrame, bool]:
    """Retorna dataframe wide por round + flag de ter barras de erro."""
    summary = os.path.join(CALIPER, "results-summary.csv")
    if os.path.exists(summary):
        long = pd.read_csv(summary)
        has_err = bool(long["throughput_tps_std"].fillna(0).gt(0).any())
    else:
        a = pd.read_csv(os.path.join(CALIPER, "results.csv")).assign(contract="ERC-6909")
        b = pd.read_csv(os.path.join(CALIPER, "results-v1.csv")).assign(contract="ERC-1155")
        long = pd.concat([a, b], ignore_index=True)
        for m in ["send_rate_tps", "avg_latency_s", "throughput_tps"]:
            long[f"{m}_mean"] = long[m]
            long[f"{m}_std"] = 0.0
        long["type"] = long["type"]
        has_err = False

    wide = None
    for contract in CONTRACTS:
        part = long[long["contract"] == contract].set_index("round")
        renamed = part.rename(
            columns={
                "method": f"method_{contract}",
                "type": f"type_{contract}",
                "throughput_tps_mean": f"thr_{contract}",
                "throughput_tps_std": f"thr_{contract}_err",
                "avg_latency_s_mean": f"lat_{contract}",
                "avg_latency_s_std": f"lat_{contract}_err",
            }
        )[[f"method_{contract}", f"type_{contract}", f"thr_{contract}", f"thr_{contract}_err",
           f"lat_{contract}", f"lat_{contract}_err"]]
        wide = renamed if wide is None else wide.join(renamed, how="outer")
    wide = wide.reset_index().sort_values("round").reset_index(drop=True)
    return wide, has_err


def grouped_bar(
    df: pd.DataFrame,
    value_cols: dict,
    path: str,
    title: str,
    ylabel: str,
    has_err: bool,
) -> None:
    fig, ax = plt.subplots(figsize=(11, 5.5))
    x = np.arange(len(df))
    w = 0.38
    labels = [short_label(m) for m in df["method_ERC-6909"]]
    for i, contract in enumerate(CONTRACTS):
        vals = df[value_cols[contract]].to_numpy(dtype=float)
        errs = df[value_cols[contract] + "_err"].to_numpy(dtype=float) if has_err else None
        pos = x + (i - 0.5) * w
        ax.bar(
            pos,
            vals,
            w,
            label=contract,
            color=COLORS[contract],
            yerr=errs if has_err else None,
            capsize=3,
            error_kw={"linewidth": 1},
        )
        for xi, v in zip(pos, vals):
            ax.annotate(
                f"{v:.2f}",
                (xi, v),
                textcoords="offset points",
                xytext=(0, 3),
                ha="center",
                fontsize=7.5,
            )
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=30, ha="right")
    ax.set_title(title + (" (μ ± σ, n≥2)" if has_err else " (n=1)"))
    ax.set_ylabel(ylabel)
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    ax.margins(y=0.12)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"OK -> {path}")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    df, has_err = load_wide()
    writes = df[df["type_ERC-6909"] == "write"].reset_index(drop=True)
    views = df[df["type_ERC-6909"].isin(["view", "pure"])].reset_index(drop=True)

    grouped_bar(
        writes,
        {"ERC-6909": "thr_ERC-6909", "ERC-1155": "thr_ERC-1155"},
        os.path.join(OUT, "throughput-writes.png"),
        "Vazão — métodos de escrita (Caliper/Besu QBFT)",
        "Throughput (TPS)",
        has_err,
    )
    grouped_bar(
        views,
        {"ERC-6909": "thr_ERC-6909", "ERC-1155": "thr_ERC-1155"},
        os.path.join(OUT, "throughput-views.png"),
        "Vazão — métodos de leitura (view/pure)",
        "Throughput (TPS)",
        has_err,
    )
    grouped_bar(
        writes,
        {"ERC-6909": "lat_ERC-6909", "ERC-1155": "lat_ERC-1155"},
        os.path.join(OUT, "latency-writes.png"),
        "Latência média — métodos de escrita (Caliper/Besu QBFT)",
        "Latência média (s)",
        has_err,
    )
    grouped_bar(
        views,
        {"ERC-6909": "lat_ERC-6909", "ERC-1155": "lat_ERC-1155"},
        os.path.join(OUT, "latency-views.png"),
        "Latência média — métodos de leitura (view/pure)",
        "Latência média (s)",
        has_err,
    )


if __name__ == "__main__":
    main()
