function pad(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function separator(widths, char = "─") {
  return widths.map((w) => char.repeat(w)).join("─┼─");
}

function printTable(headers, rows, colWidths) {
  const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join(" │ ");
  console.log(`│ ${headerLine} │`);
  console.log(`├─${separator(colWidths)}─┤`);

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const s = String(cell);
      // Right-align numbers
      if (/^[\d.,±%]+$/.test(s) || s.endsWith(" TPS") || s.endsWith("ms") || s.endsWith(" KB")) {
        return padLeft(s, colWidths[i]);
      }
      return pad(s, colWidths[i]);
    }).join(" │ ");
    console.log(`│ ${line} │`);
  }
}

function printRoundResult(label, description, config, sutResults) {
  const roundInfo = config.tps
    ? `${config.txNumber || "?"} TXs, fixed-rate ${config.txNumber ? config.tps + " TPS" : ""}`
    : config.txDuration
    ? `${config.txDuration}s, maximum-rate`
    : config.txNumber
    ? `${config.txNumber} TXs`
    : "";

  console.log(`\n┌─ Round: ${label}${roundInfo ? " (" + roundInfo + ")" : ""} ─`);
  if (description) console.log(`│  ${description}`);

  // Determine which metrics to show based on the round
  const hasGas = sutResults.some((r) => r.stats.gas.avg > 0);
  const isView = sutResults.every((r) => r.stats.gas.avg === 0);

  const headers = ["Métrica", ...sutResults.map((r) => r.sut), "Δ%"];
  const colWidths = [16, ...sutResults.map(() => 12), 8];

  const rows = [];

  // Success/Fail
  rows.push([
    "Succ/Fail",
    ...sutResults.map((r) => `${r.stats.success}/${r.stats.failed}`),
    "—",
  ]);

  // Success Rate
  rows.push([
    "Succ Rate",
    ...sutResults.map((r) => `${r.stats.successRate}%`),
    "—",
  ]);

  // Throughput
  if (sutResults.length === 2) {
    const [a, b] = sutResults.map((r) => parseFloat(r.stats.throughput));
    const diff = a > 0 ? (((b - a) / a) * 100).toFixed(1) : "0.0";
    rows.push(["Achieved TPS", ...sutResults.map((r) => `${r.stats.throughput} TPS`), `${diff > 0 ? "+" : ""}${diff}%`]);
  } else {
    rows.push(["Achieved TPS", ...sutResults.map((r) => `${r.stats.throughput} TPS`), "—"]);
  }

  // Latency
  if (sutResults.length === 2) {
    const [a, b] = sutResults.map((r) => r.stats.latency.avg);
    const diff = a > 0 ? (((b - a) / a) * 100).toFixed(1) : "0.0";
    rows.push(["Latency avg", ...sutResults.map((r) => `${r.stats.latency.avg}ms`), `${diff}%`]);
  } else {
    rows.push(["Latency avg", ...sutResults.map((r) => `${r.stats.latency.avg}ms`), "—"]);
  }

  rows.push(["Latency min", ...sutResults.map((r) => `${r.stats.latency.min}ms`), "—"]);
  rows.push(["Latency max", ...sutResults.map((r) => `${r.stats.latency.max}ms`), "—"]);
  rows.push(["Latency p50", ...sutResults.map((r) => `${r.stats.latency.p50}ms`), "—"]);
  rows.push(["Latency p95", ...sutResults.map((r) => `${r.stats.latency.p95}ms`), "—"]);

  if (!isView) {
    rows.push(["Latency σ", ...sutResults.map((r) => `${r.stats.latency.stddev}ms`), "—"]);
  }

  // Gas
  if (hasGas) {
    if (sutResults.length === 2) {
      const [a, b] = sutResults.map((r) => r.stats.gas.avg);
      const diff = a > 0 ? (((b - a) / a) * 100).toFixed(1) : "0.0";
      rows.push(["Gas avg", ...sutResults.map((r) => `${r.stats.gas.avg.toLocaleString()}`), `${diff}%`]);
    } else {
      rows.push(["Gas avg", ...sutResults.map((r) => `${r.stats.gas.avg.toLocaleString()}`), "—"]);
    }
    rows.push(["Gas min", ...sutResults.map((r) => `${r.stats.gas.min.toLocaleString()}`), "—"]);
    rows.push(["Gas max", ...sutResults.map((r) => `${r.stats.gas.max.toLocaleString()}`), "—"]);
    rows.push(["Gas σ", ...sutResults.map((r) => `${r.stats.gas.stddev.toLocaleString()}`), "—"]);
    rows.push(["Gas total", ...sutResults.map((r) => `${r.stats.gas.total.toLocaleString()}`), "—"]);
  }

  rows.push(["Elapsed", ...sutResults.map((r) => `${r.stats.elapsed}s`), "—"]);

  printTable(headers, rows, colWidths);
  console.log(`└${"─".repeat(colWidths.reduce((a, b) => a + b + 3, 0) + 1)}`);
}

function printSummary(results, config) {
  const rounds = [...new Set(results.map((r) => r.round))];

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log(`║  ${config.name}`);
  console.log(`║  ${config.description}`);
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  for (const roundLabel of rounds) {
    const roundConfig = config.rounds.find((r) => r.label === roundLabel);
    const sutResults = results.filter((r) => r.round === roundLabel);
    printRoundResult(
      roundLabel,
      roundConfig?.description || "",
      roundConfig?.rateControl?.opts || {},
      sutResults
    );
  }

  // Final comparison summary
  if (config.suts.length === 2) {
    const sut1 = config.suts[0].name;
    const sut2 = config.suts[1].name;

    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log(`║  RESUMO: ${sut1} vs ${sut2}`);
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const headers = ["Round", "1155 Gas", "6909 Gas", "Gas Δ%", "1155 TPS", "6909 TPS", "TPS Δ%"];
    const colWidths = [14, 12, 12, 8, 10, 10, 8];
    const rows = [];

    for (const roundLabel of rounds) {
      const r1 = results.find((r) => r.round === roundLabel && r.sut === sut1);
      const r2 = results.find((r) => r.round === roundLabel && r.sut === sut2);
      if (!r1 || !r2) continue;

      const gas1 = r1.stats.gas.avg;
      const gas2 = r2.stats.gas.avg;
      const gasDiff = gas1 > 0 ? (((gas1 - gas2) / gas1) * 100).toFixed(1) : "—";

      const tps1 = parseFloat(r1.stats.throughput);
      const tps2 = parseFloat(r2.stats.throughput);
      const tpsDiff = tps1 > 0 ? (((tps2 - tps1) / tps1) * 100).toFixed(1) : "—";

      rows.push([
        roundLabel,
        gas1 > 0 ? gas1.toLocaleString() : "—",
        gas2 > 0 ? gas2.toLocaleString() : "—",
        gasDiff !== "—" ? `${gasDiff}%` : "—",
        `${tps1} TPS`,
        `${tps2} TPS`,
        tpsDiff !== "—" ? `${tpsDiff > 0 ? "+" : ""}${tpsDiff}%` : "—",
      ]);
    }

    printTable(headers, rows, colWidths);
  }

  // Bytecode comparison (read once)
  console.log("\n┌─ Deploy Size ─");
  console.log(`│  (medido na inicialização dos contratos)`);
  console.log(`└`);
}

module.exports = { printRoundResult, printSummary, printTable };
