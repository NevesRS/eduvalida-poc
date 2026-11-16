#!/usr/bin/env python3
"""Consolida runs do Caliper em média ± desvio amostral (n >= 1).

Lee caliper/results-6909-run*.csv e caliper/results-v1-run*.csv,
escreve caliper/results-summary.csv com mean/std por (contract, round).
"""
import glob
import os

import numpy as np
import pandas as pd

CALIPER = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = {
    "ERC-6909": "results-6909-run*.csv",
    "ERC-1155": "results-v1-run*.csv",
}
METRICS = [
    "send_rate_tps",
    "max_latency_s",
    "min_latency_s",
    "avg_latency_s",
    "throughput_tps",
]


def sample_std(series: pd.Series) -> float:
    if len(series) < 2:
        return 0.0
    return float(np.std(series.to_numpy(dtype=float), ddof=1))


def main() -> None:
    rows = []
    for contract, pattern in CONTRACTS.items():
        files = sorted(glob.glob(os.path.join(CALIPER, pattern)))
        if not files:
            print(f"AVISO: nenhum arquivo para {contract} ({pattern})")
            continue
        dfs = [pd.read_csv(f) for f in files]
        n_rounds = {len(d) for d in dfs}
        if len(n_rounds) != 1:
            raise SystemExit(f"ERRO: {contract}: runs com contagens de round diferentes: {n_rounds}")
        df = pd.concat(dfs, ignore_index=True)
        print(f"{contract}: {len(files)} run(s), rounds por run: {n_rounds.pop()}")

        meta = (
            df.groupby("round", as_index=False)
            .agg(method=("method", "first"), type=("type", "first"))
            .set_index("round")
        )
        for round_no, group in df.groupby("round"):
            base = meta.loc[round_no]
            row = {
                "contract": contract,
                "round": int(round_no),
                "method": base["method"],
                "type": base["type"],
                "runs": len(files),
            }
            for m in METRICS:
                vals = group[m].astype(float)
                row[f"{m}_mean"] = round(float(vals.mean()), 3)
                row[f"{m}_std"] = round(sample_std(vals), 3)
            rows.append(row)

    out = pd.DataFrame(rows).sort_values(["contract", "round"])
    dest = os.path.join(CALIPER, "results-summary.csv")
    out.to_csv(dest, index=False)
    print(f"OK -> {dest} ({len(out)} linhas)")


if __name__ == "__main__":
    main()
