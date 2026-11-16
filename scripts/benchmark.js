const { ethers } = require("hardhat");

const SKILL_NAME = "Solidity Basics";
const SKILL_TYPE = ethers.keccak256(ethers.toUtf8Bytes(SKILL_NAME));
const ITERATIONS = 50;

async function deployV1(deployer, instA, instB) {
  const Factory = await ethers.getContractFactory("SkillTokenV1");
  const token = await Factory.deploy();
  await token.waitForDeployment();
  await token.setIssuer(instA.address, true);
  await token.setIssuer(instB.address, true);
  await token.createSkill(SKILL_NAME);
  return token;
}

async function deployV2(deployer, instA, instB) {
  const Factory = await ethers.getContractFactory("SkillToken");
  const token = await Factory.deploy();
  await token.waitForDeployment();
  await token.setIssuer(instA.address, true);
  await token.setIssuer(instB.address, true);
  await token.createSkill(SKILL_NAME);
  return token;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function benchmarkCreateSkill(label, token) {
  const [, , , , , , , , , , extra] = await ethers.getSigners();
  const times = [];
  const gases = [];

  for (let i = 0; i < 5; i++) {
    const name = `Skill_${label}_${i}_${Date.now()}`;
    const start = Date.now();
    const tx = await token.createSkill(name);
    const receipt = await tx.wait();
    times.push(Date.now() - start);
    gases.push(Number(receipt.gasUsed));
  }

  return {
    function: "createSkill",
    avgGas: Math.round(avg(gases)),
    avgLatency: Math.round(avg(times)),
  };
}

async function benchmarkIssueSkill(label, token, issuer, student) {
  const times = [];
  const gases = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const name = `Skill_${label}_${i}_${Date.now()}`;
    await token.createSkill(name);
    const type = ethers.keccak256(ethers.toUtf8Bytes(name));

    const start = Date.now();
    const tx = await token.connect(issuer).issueSkill(student.address, type);
    const receipt = await tx.wait();
    times.push(Date.now() - start);
    gases.push(Number(receipt.gasUsed));
  }

  return {
    function: "issueSkill",
    avgGas: Math.round(avg(gases)),
    avgLatency: Math.round(avg(times)),
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
  };
}

async function benchmarkRevoke(label, token, issuer, student) {
  const times = [];
  const gases = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const name = `Skill_${label}_revoke_${i}_${Date.now()}`;
    await token.createSkill(name);
    const type = ethers.keccak256(ethers.toUtf8Bytes(name));
    await token.connect(issuer).issueSkill(student.address, type);

    const start = Date.now();
    const tx = await token.connect(issuer).revoke(student.address, type);
    const receipt = await tx.wait();
    times.push(Date.now() - start);
    gases.push(Number(receipt.gasUsed));
  }

  return {
    function: "revoke",
    avgGas: Math.round(avg(gases)),
    avgLatency: Math.round(avg(times)),
    p50: percentile(times, 50),
    p95: percentile(times, 95),
  };
}

async function benchmarkHasSkill(label, token, issuer, student) {
  const times = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const name = `Skill_${label}_view_${i}_${Date.now()}`;
    await token.createSkill(name);
    const type = ethers.keccak256(ethers.toUtf8Bytes(name));
    await token.connect(issuer).issueSkill(student.address, type);

    const start = Date.now();
    await token.hasSkill(student.address, type);
    times.push(Date.now() - start);
  }

  return {
    function: "hasSkill (view)",
    avgLatency: Math.round(avg(times)),
    p50: percentile(times, 50),
    p95: percentile(times, 95),
  };
}

async function benchmarkThroughput(label, token, issuer, student) {
  const TX_COUNT = 20;
  const startBatch = Date.now();

  const txPromises = [];
  for (let i = 0; i < TX_COUNT; i++) {
    const name = `Skill_${label}_batch_${i}_${Date.now()}_${i}`;
    txPromises.push(
      token.createSkill(name).then((tx) => tx.wait())
    );
  }
  await Promise.all(txPromises);

  const totalBatchMs = Date.now() - startBatch;
  const tps = (TX_COUNT / totalBatchMs) * 1000;

  return {
    scenario: "batch",
    txCount: TX_COUNT,
    totalMs: totalBatchMs,
    tps: Math.round(tps * 10) / 10,
  };
}

function printTable(rows, columns) {
  const widths = columns.map((c) => {
    const maxVal = Math.max(
      c.label.length,
      ...rows.map((r) => String(r[c.key] ?? "").length)
    );
    return Math.max(maxVal, 4);
  });

  const header = columns.map((c, idx) => c.label.padEnd(widths[idx])).join(" | ");
  const sep = columns.map((c, idx) => "-".repeat(widths[idx])).join("-+-");

  console.log(`| ${header} |`);
  console.log(`|-${sep}-|`);

  for (const row of rows) {
    const line = columns
      .map((c, idx) => String(row[c.key] ?? "").padEnd(widths[idx]))
      .join(" | ");
    console.log(`| ${line} |`);
  }
}

async function main() {
  const [deployer, instA, instB, student] = await ethers.getSigners();

  console.log("=== EduValida POC — ERC-1155 vs ERC-6909 Benchmark ===\n");

  console.log("Deploying contracts...");
  const v1 = await deployV1(deployer, instA, instB);
  const v2 = await deployV2(deployer, instA, instB);
  console.log("Done.\n");

  // ─── Cenário 1: Gas por função ────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("  CENÁRIO 1: Gas por Função (média de 50 execuções)");
  console.log("═══════════════════════════════════════════════════════\n");

  const issueV1 = await benchmarkIssueSkill("v1", v1, instA, student);
  const issueV2 = await benchmarkIssueSkill("v2", v2, instA, student);

  const revokeV1 = await benchmarkRevoke("v1", v1, instA, student);
  const revokeV2 = await benchmarkRevoke("v2", v2, instA, student);

  const createV1 = await benchmarkCreateSkill("v1", v1);
  const createV2 = await benchmarkCreateSkill("v2", v2);

  const gasRows = [
    {
      function: "createSkill",
      "ERC-1155": createV1.avgGas,
      "ERC-6909": createV2.avgGas,
      saving: `${Math.round(((createV1.avgGas - createV2.avgGas) / createV1.avgGas) * 100)}%`,
    },
    {
      function: "issueSkill",
      "ERC-1155": issueV1.avgGas,
      "ERC-6909": issueV2.avgGas,
      saving: `${Math.round(((issueV1.avgGas - issueV2.avgGas) / issueV1.avgGas) * 100)}%`,
    },
    {
      function: "revoke",
      "ERC-1155": revokeV1.avgGas,
      "ERC-6909": revokeV2.avgGas,
      saving: `${Math.round(((revokeV1.avgGas - revokeV2.avgGas) / revokeV1.avgGas) * 100)}%`,
    },
  ];

  printTable(gasRows, [
    { key: "function", label: "Função" },
    { key: "ERC-1155", label: "ERC-1155 (gas)" },
    { key: "ERC-6909", label: "ERC-6909 (gas)" },
    { key: "saving", label: "Δ%" },
  ]);

  // ─── Cenário 2: Latência ─────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  CENÁRIO 2: Latência (ms) — 50 transações");
  console.log("═══════════════════════════════════════════════════════\n");

  const latencyRows = [
    {
      function: "issueSkill",
      "ERC-1155 p50": `${issueV1.p50}ms`,
      "ERC-6909 p50": `${issueV2.p50}ms`,
      "ERC-1155 p95": `${issueV1.p95}ms`,
      "ERC-6909 p95": `${issueV2.p95}ms`,
    },
    {
      function: "revoke",
      "ERC-1155 p50": `${revokeV1.p50}ms`,
      "ERC-6909 p50": `${revokeV2.p50}ms`,
      "ERC-1155 p95": `${revokeV1.p95}ms`,
      "ERC-6909 p95": `${revokeV2.p95}ms`,
    },
  ];

  printTable(latencyRows, [
    { key: "function", label: "Função" },
    { key: "ERC-1155 p50", label: "1155 p50" },
    { key: "ERC-6909 p50", label: "6909 p50" },
    { key: "ERC-1155 p95", label: "1155 p95" },
    { key: "ERC-6909 p95", label: "6909 p95" },
  ]);

  // ─── Cenário 3: View calls ────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  CENÁRIO 3: View Calls (hasSkill)");
  console.log("═══════════════════════════════════════════════════════\n");

  const hasSkillV1 = await benchmarkHasSkill("v1", v1, instA, student);
  const hasSkillV2 = await benchmarkHasSkill("v2", v2, instA, student);

  console.log(`  ERC-1155  → p50: ${hasSkillV1.p50}ms | p95: ${hasSkillV1.p95}ms | avg: ${hasSkillV1.avgLatency}ms`);
  console.log(`  ERC-6909  → p50: ${hasSkillV2.p50}ms | p95: ${hasSkillV2.p95}ms | avg: ${hasSkillV2.avgLatency}ms`);

  // ─── Cenário 4: Throughput ────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  CENÁRIO 4: Throughput (createSkill × 20 paralelas)");
  console.log("═══════════════════════════════════════════════════════\n");

  const throughputV1 = await benchmarkThroughput("v1", v1, instA, student);
  const throughputV2 = await benchmarkThroughput("v2", v2, instA, student);

  console.log(`  ERC-1155  → ${throughputV1.tps} TPS (${throughputV1.totalMs}ms para ${throughputV1.txCount} txs)`);
  console.log(`  ERC-6909  → ${throughputV2.tps} TPS (${throughputV2.totalMs}ms para ${throughputV2.txCount} txs)`);
  console.log(`  Diferença → ${Math.round(((throughputV2.tps - throughputV1.tps) / throughputV1.tps) * 100)}% mais rápido`);

  // ─── Deploy size ──────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  CONTRATO: Tamanho do Bytecode");
  console.log("═══════════════════════════════════════════════════════\n");

  const codeV1 = await ethers.provider.getCode(await v1.getAddress());
  const codeV2 = await ethers.provider.getCode(await v2.getAddress());

  console.log(`  ERC-1155  → ${(codeV1.length - 2) / 2} bytes (${((codeV1.length - 2) / 2 / 1024).toFixed(1)} KB)`);
  console.log(`  ERC-6909  → ${(codeV2.length - 2) / 2} bytes (${((codeV2.length - 2) / 2 / 1024).toFixed(1)} KB)`);
  console.log(`  Diferença → ${Math.round(((codeV1.length - codeV2.length) / codeV1.length) * 100)}% menor`);

  console.log("\n=== FIM ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
