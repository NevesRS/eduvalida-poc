const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { TxCollector } = require("./tx-collector");
const { createRateController } = require("./rate-controllers");
const { printSummary } = require("./reporter");

const RUNS = parseInt(process.env.BENCHMARK_RUNS || "3", 10);

function loadConfig() {
  const configPath = path.join(__dirname, "config.yaml");
  const raw = fs.readFileSync(configPath, "utf8");
  return yaml.parse(raw);
}

function loadWorkload(modulePath) {
  const fullPath = path.join(__dirname, modulePath);
  delete require.cache[require.resolve(fullPath)];
  return require(fullPath);
}

async function deployContract(contractName) {
  const Factory = await ethers.getContractFactory(contractName);
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  return contract;
}

async function setupAccounts(contract) {
  const signers = await ethers.getSigners();
  const [, institution] = signers;
  await contract.setIssuer(institution.address, true);
  return signers;
}

async function executeRound({ round, contract, signers, roundIndex }) {
  const workload = loadWorkload(round.workload.module);
  const collector = new TxCollector();
  const rateController = createRateController(round.rateControl);

  const roundContext = await workload.setup(contract, signers);

  let txCount;
  if (round.txNumber) {
    txCount = round.txNumber;
  } else if (round.txDuration) {
    const tps = round.rateControl.opts?.tps || round.rateControl.opts?.maxTps || 10;
    txCount = tps * round.txDuration;
  } else {
    txCount = 50;
  }

  collector.start();
  const startTime = Date.now();

  for (let i = 0; i < txCount; i++) {
    await rateController.wait(i, startTime);

    if (round.txDuration) {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= round.txDuration) break;
    }

    try {
      const txStart = Date.now();
      const { fn } = await workload.createTx(contract, signers, { roundIndex, txIndex: i }, roundContext);
      const result = await fn();
      const receipt = await result.wait?.() || result;
      const txEnd = Date.now();

      collector.add({
        gas: receipt.gasUsed ? Number(receipt.gasUsed) : 0,
        latency: txEnd - txStart,
        success: true,
      });
    } catch (err) {
      collector.add({
        gas: 0,
        latency: 1,
        success: false,
        error: err.message,
      });
    }
  }

  collector.stop();
  return collector.summary();
}

async function runOnce(runNum, config) {
  const results = [];

  for (const sut of config.suts) {
    const contract = await deployContract(sut.contract);
    const signers = await setupAccounts(contract);

    for (let ri = 0; ri < config.rounds.length; ri++) {
      const round = config.rounds[ri];
      const stats = await executeRound({ round, contract, signers, roundIndex: ri });
      results.push({ sut: sut.name, round: round.label, stats });
    }
  }

  return results;
}

function aggregateResults(allRunResults) {
  const runs = allRunResults.length;
  const keys = {};

  // Collect all metric keys
  for (const run of allRunResults) {
    for (const entry of run) {
      const key = `${entry.sut}|${entry.round}`;
      if (!keys[key]) keys[key] = [];
      keys[key].push(entry.stats);
    }
  }

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function stddev(arr) {
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  }

  const consolidated = [];
  for (const [key, statsArr] of Object.entries(keys)) {
    const [sut, round] = key.split("|");
    consolidated.push({
      sut,
      round,
      runs,
      stats: {
        successRate: {
          avg: avg(statsArr.map((s) => parseFloat(s.successRate))).toFixed(1),
        },
        throughput: {
          avg: avg(statsArr.map((s) => parseFloat(s.throughput))).toFixed(1),
          stddev: stddev(statsArr.map((s) => parseFloat(s.throughput))).toFixed(1),
        },
        gas: {
          avg: Math.round(avg(statsArr.map((s) => s.gas.avg))),
          min: Math.min(...statsArr.map((s) => s.gas.min)),
          max: Math.max(...statsArr.map((s) => s.gas.max)),
          stddev: Math.round(stddev(statsArr.map((s) => s.gas.avg))),
          total: statsArr[0].gas.total, // representative
        },
        latency: {
          avg: Math.round(avg(statsArr.map((s) => s.latency.avg))),
          min: Math.min(...statsArr.map((s) => s.latency.min)),
          max: Math.max(...statsArr.map((s) => s.latency.max)),
          p50: Math.round(avg(statsArr.map((s) => s.latency.p50))),
          p95: Math.round(avg(statsArr.map((s) => s.latency.p95))),
          stddev: Math.round(stddev(statsArr.map((s) => s.latency.avg))),
        },
      },
    });
  }

  return consolidated;
}

function printConsolidatedSummary(results, config, codeSizes, allRunResults) {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════════════════════╗");
  console.log(`║  ${config.name}`);
  console.log(`║  ${config.description}`);
  console.log(`║  ${allRunResults.length} runs × ${config.rounds.length} rounds × ${config.suts.length} contratos`);
  console.log("╚══════════════════════════════════════════════════════════════════════════════════╝");

  // Per-round detail
  const rounds = [...new Set(results.map((r) => r.round))];
  for (const roundLabel of rounds) {
    const roundConfig = config.rounds.find((r) => r.label === roundLabel);
    const sutResults = results.filter((r) => r.round === roundLabel);

    const hasGas = sutResults.some((r) => r.stats.gas.avg > 0);
    const headers = ["Métrica", ...sutResults.map((r) => `${r.sut} (μ±σ)`), "Δ%"];
    const colWidths = [16, ...sutResults.map(() => 20), 10];
    const rows = [];

    // Throughput
    if (sutResults.length === 2) {
      const [a, b] = sutResults.map((r) => parseFloat(r.stats.throughput.avg));
      const diff = a > 0 ? (((b - a) / a) * 100).toFixed(1) : "0.0";
      rows.push([
        "Throughput",
        ...sutResults.map((r) => `${r.stats.throughput.avg}±${r.stats.throughput.stddev} TPS`),
        `${diff > 0 ? "+" : ""}${diff}%`,
      ]);
    } else {
      rows.push(["Throughput", ...sutResults.map((r) => `${r.stats.throughput.avg}±${r.stats.throughput.stddev} TPS`), "—"]);
    }

    // Latency
    if (sutResults.length === 2) {
      const [a, b] = sutResults.map((r) => r.stats.latency.avg);
      const diff = a > 0 ? (((b - a) / a) * 100).toFixed(1) : "0.0";
      rows.push([
        "Latency avg",
        ...sutResults.map((r) => `${r.stats.latency.avg}±${r.stats.latency.stddev}ms`),
        `${diff}%`,
      ]);
    } else {
      rows.push(["Latency avg", ...sutResults.map((r) => `${r.stats.latency.avg}±${r.stats.latency.stddev}ms`), "—"]);
    }

    rows.push(["Latency min", ...sutResults.map((r) => `${r.stats.latency.min}ms`), "—"]);
    rows.push(["Latency max", ...sutResults.map((r) => `${r.stats.latency.max}ms`), "—"]);
    rows.push(["Latency p50", ...sutResults.map((r) => `${r.stats.latency.p50}ms`), "—"]);
    rows.push(["Latency p95", ...sutResults.map((r) => `${r.stats.latency.p95}ms`), "—"]);

    // Gas
    if (hasGas) {
      if (sutResults.length === 2) {
        const [a, b] = sutResults.map((r) => r.stats.gas.avg);
        const diff = a > 0 ? (((a - b) / a) * 100).toFixed(1) : "0.0";
        rows.push([
          "Gas avg",
          ...sutResults.map((r) => `${r.stats.gas.avg.toLocaleString()}±${r.stats.gas.stddev.toLocaleString()}`),
          `${diff}%`,
        ]);
      } else {
        rows.push(["Gas avg", ...sutResults.map((r) => `${r.stats.gas.avg.toLocaleString()}±${r.stats.gas.stddev.toLocaleString()}`), "—"]);
      }
      rows.push(["Gas min", ...sutResults.map((r) => r.stats.gas.min.toLocaleString()), "—"]);
      rows.push(["Gas max", ...sutResults.map((r) => r.stats.gas.max.toLocaleString()), "—"]);
    }

    // Header
    console.log(`\n┌─ Round: ${roundLabel}${roundConfig ? " — " + roundConfig.description : ""} ─`);

    const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ");
    console.log(`│ ${headerLine} │`);
    console.log(`├─${colWidths.map((w) => "─".repeat(w)).join("─┼─")}─┤`);

    for (const row of rows) {
      const line = row.map((cell, i) => {
        const s = String(cell);
        if (/^[\d.,±%\-]+$/.test(s) || s.endsWith(" TPS") || s.endsWith("ms") || s.endsWith(" KB")) {
          return s.padStart(colWidths[i]);
        }
        return s.padEnd(colWidths[i]);
      }).join(" │ ");
      console.log(`│ ${line} │`);
    }
    console.log(`└${"─".repeat(colWidths.reduce((a, b) => a + b + 3, 0) + 1)}`);
  }

  // Final comparison
  if (config.suts.length === 2) {
    const sut1 = config.suts[0].name;
    const sut2 = config.suts[1].name;

    console.log("\n╔══════════════════════════════════════════════════════════════════════════════════╗");
    console.log(`║  RESUMO FINAL: ${sut1} vs ${sut2} (${allRunResults.length} runs)`);
    console.log("╚══════════════════════════════════════════════════════════════════════════════════╝");

    const headers = ["Round", "1155 Gas (μ±σ)", "6909 Gas (μ±σ)", "Gas Δ%", "1155 TPS (μ±σ)", "6909 TPS (μ±σ)", "TPS Δ%"];
    const colWidths = [14, 18, 18, 8, 16, 16, 10];
    const rows = [];

    for (const roundLabel of rounds) {
      const r1 = results.find((r) => r.round === roundLabel && r.sut === sut1);
      const r2 = results.find((r) => r.round === roundLabel && r.sut === sut2);
      if (!r1 || !r2) continue;

      const gas1 = r1.stats.gas.avg;
      const gas2 = r2.stats.gas.avg;
      const gasDiff = gas1 > 0 ? (((gas1 - gas2) / gas1) * 100).toFixed(1) : "—";

      const tps1 = parseFloat(r1.stats.throughput.avg);
      const tps2 = parseFloat(r2.stats.throughput.avg);
      const tpsDiff = tps1 > 0 ? (((tps2 - tps1) / tps1) * 100).toFixed(1) : "—";

      rows.push([
        roundLabel,
        gas1 > 0 ? `${gas1.toLocaleString()}±${r1.stats.gas.stddev}` : "—",
        gas2 > 0 ? `${gas2.toLocaleString()}±${r2.stats.gas.stddev}` : "—",
        gasDiff !== "—" ? `${gasDiff}%` : "—",
        `${tps1}±${r1.stats.throughput.stddev}`,
        `${tps2}±${r2.stats.throughput.stddev}`,
        tpsDiff !== "—" ? `${tpsDiff > 0 ? "+" : ""}${tpsDiff}%` : "—",
      ]);
    }

    const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ");
    console.log(`│ ${headerLine} │`);
    console.log(`├─${colWidths.map((w) => "─".repeat(w)).join("─┼─")}─┤`);

    for (const row of rows) {
      const line = row.map((cell, i) => {
        const s = String(cell);
        if (/^[\d.,±%\-]+$/.test(s) || s.endsWith(" TPS") || s.endsWith("ms")) {
          return s.padStart(colWidths[i]);
        }
        return s.padEnd(colWidths[i]);
      }).join(" │ ");
      console.log(`│ ${line} │`);
    }
  }

  // Bytecode
  console.log("\n┌─ Deploy Size (bytecode) ─");
  for (const [name, size] of Object.entries(codeSizes)) {
    console.log(`│  ${name.padEnd(12)} → ${size.toLocaleString()} bytes (${(size / 1024).toFixed(1)} KB)`);
  }
  if (config.suts.length === 2) {
    const [a, b] = Object.values(codeSizes);
    const diff = (((a - b) / a) * 100).toFixed(1);
    console.log(`│  Diferença  → ${diff}% menor (ERC-6909)`);
  }
  console.log("└");
}

async function main() {
  const config = loadConfig();

  console.log("╔══════════════════════════════════════════════════════════════════════════════════╗");
  console.log(`║  ${config.name}`);
  console.log(`║  ${config.description}`);
  console.log(`║  ${RUNS} runs × ${config.rounds.length} rounds × ${config.suts.length} contratos`);
  console.log("╚══════════════════════════════════════════════════════════════════════════════════╝\n");

  // Deploy and measure bytecode (once)
  const codeSizes = {};
  for (const sut of config.suts) {
    process.stdout.write(`  Deploying ${sut.name} (${sut.contract})... `);
    const contract = await deployContract(sut.contract);
    const code = await ethers.provider.getCode(await contract.getAddress());
    codeSizes[sut.name] = (code.length - 2) / 2;
    console.log(`${codeSizes[sut.name]} bytes (${(codeSizes[sut.name] / 1024).toFixed(1)} KB)`);
  }

  // Run benchmark N times
  const allRunResults = [];

  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n━━━━ Run ${run}/${RUNS} ━━━━`);
    const runResults = await runOnce(run, config);
    allRunResults.push(runResults);

    // Print compact per-run summary
    for (const entry of runResults) {
      const gasStr = entry.stats.gas.avg > 0 ? ` | gas=${entry.stats.gas.avg.toLocaleString()}` : "";
      console.log(`  ${entry.sut.padEnd(12)} ${entry.round.padEnd(14)} → ${entry.stats.throughput} TPS | ${entry.stats.success}/${entry.stats.total} TXs${gasStr}`);
    }
  }

  // Aggregate
  const consolidated = aggregateResults(allRunResults);

  // Print final report
  printConsolidatedSummary(consolidated, config, codeSizes, allRunResults);

  console.log(`\n✓ Benchmark completo (${RUNS} runs).\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
