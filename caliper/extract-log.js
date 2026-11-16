#!/usr/bin/env node
// Extrai a tabela final de um log do Caliper para CSV no schema results-*.csv.
// Uso: node caliper/extract-log.js <log> <out.csv> <6909|1155>
"use strict";

const fs = require("fs");

const ROUND_ORDER = [
  "issueSkill", "hasSkill", "revoke", "createSkill", "setSkillName",
  "setSkillBadgeURI", "setSkillThreshold", "setIssuer", "skillId",
  "skillAttestationCount", "hasSkillFrom", "getKnownSkillTypes",
  "getIssuersList", "getters", "throughput",
];
const WRITE_METHODS = new Set([
  "issueSkill", "revoke", "createSkill", "setSkillName", "setSkillBadgeURI",
  "setSkillThreshold", "setIssuer", "throughput",
]);

const [logPath, outPath, flavor] = process.argv.slice(2);
if (!logPath || !outPath || !["6909", "1155"].includes(flavor)) {
  console.error("Uso: extract-log.js <log> <out.csv> <6909|1155>");
  process.exit(1);
}

const lines = fs.readFileSync(logPath, "utf8").split("\n");
const byMethod = new Map(); // última ocorrência = tabela final consolidada
for (const line of lines) {
  if (!/^\| [a-zA-Z]/.test(line) || /\| *Name|\| *-/.test(line)) continue;
  const cols = line.split("|").map((s) => s.trim()).filter(Boolean);
  if (cols.length !== 8) continue;
  const [rawName, succ, fail, send, max, min, avg, tput] = cols;
  byMethod.set(rawName, { rawName, succ, fail, send, max, min, avg, tput });
}

const suffix = flavor === "1155" ? "-1155" : "";
const rows = [];
for (const [rawName, r] of byMethod) {
  const suffixLen = suffix.length;
  let method = suffixLen > 0 && rawName.endsWith(suffix) ? rawName.slice(0, -suffixLen) : rawName;
  if (method.startsWith("throughput")) method = "throughput";
  const type = method === "throughput" || WRITE_METHODS.has(method) ? "write"
    : method === "skillId" ? "pure" : "view";
  rows.push({ ...r, method, type });
}
rows.sort((a, b) => ROUND_ORDER.indexOf(a.method) - ROUND_ORDER.indexOf(b.method));
if (rows.length !== 15) {
  console.error(`ERRO: esperado 15 rounds, achei ${rows.length}: ${rows.map((r) => r.method).join(", ")}`);
  process.exit(2);
}

const header = "round,method,type,succ,fail,send_rate_tps,max_latency_s,min_latency_s,avg_latency_s,throughput_tps";
const body = rows.map((r, i) =>
  [i + 1, r.method, r.type, r.succ, r.fail, r.send, r.max, r.min, r.avg, r.tput].join(",")
).join("\n");
fs.writeFileSync(outPath, header + "\n" + body + "\n");
console.log(`OK -> ${outPath} (${rows.length} rounds)`);
