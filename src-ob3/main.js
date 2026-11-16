import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import bs58 from "bs58";

const API = "";

let currentRole = "institution1";
let currentThreshold = 1;
let knownSkills = [];
let knownCertTypes = [];
let studentDid = null;

function log(msg, type = "info") {
  const el = document.getElementById("log-entries");
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(entry);
}

function shortId(id) {
  if (!id) return "";
  return id.length > 20 ? `${id.slice(0, 10)}...${id.slice(-4)}` : id;
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function flashCopied(btn) {
  btn.classList.add("copied");
  btn.textContent = "✓";
  setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "⧉"; }, 1200);
}

// ===== Student DID (Ed25519 no localStorage) =====
function getOrGenerateStudentDid() {
  const privHex = localStorage.getItem("ob3_student_priv");
  if (privHex) {
    const priv = hexToBytes(privHex);
    const pub = ed25519.getPublicKey(priv);
    return { priv, pub, did: toDidKey(pub) };
  }
  const priv = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(priv);
  localStorage.setItem("ob3_student_priv", bytesToHex(priv));
  return { priv, pub, did: toDidKey(pub) };
}

function toDidKey(pubBytes) {
  const multicodec = new Uint8Array([0xed, 0x01, ...pubBytes]);
  return "did:key:z" + bs58.encode(multicodec);
}

function refreshStudentDid() {
  const kp = getOrGenerateStudentDid();
  studentDid = kp.did;
  document.getElementById("student-did-box").textContent = studentDid;
  return kp;
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (currentRole !== "student") headers["X-Issuer"] = currentRole;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function updateWalletInfo() {
  const el = document.getElementById("wallet-info");
  if (currentRole === "student") {
    el.textContent = `${shortId(studentDid)} (aluno)`;
    document.getElementById("copy-wallet").onclick = async () => {
      if (await copyToClipboard(studentDid)) flashCopied(document.getElementById("copy-wallet"));
    };
  } else {
    el.textContent = `${currentRole}`;
    document.getElementById("copy-wallet").onclick = async () => {
      if (await copyToClipboard(currentRole)) flashCopied(document.getElementById("copy-wallet"));
    };
  }
}

async function switchView(role) {
  currentRole = role;
  const isInstitution = role === "institution1" || role === "institution2";
  document.getElementById("institution-view").style.display = isInstitution ? "block" : "none";
  document.getElementById("student-view").style.display = role === "student" ? "block" : "none";
  try { await loadAll(); renderSkillCheckboxes(); renderSkillSelect(); renderInstCertTypes(); } catch {}
  updateWalletInfo();
  if (isInstitution) {
    loadThreshold();
  } else {
    refreshStudentDid();
    refreshSkills();
    refreshCertTypes();
    refreshClaimedCerts();
  }
}

async function loadAll() {
  knownSkills = await api("/api/skills");
  knownCertTypes = await api("/api/cert-types");
}

function renderSkillCheckboxes() {
  const container = document.getElementById("cert-skills-select");
  if (knownSkills.length === 0) {
    container.innerHTML = "<em>Nenhuma skill conhecida. Crie uma skill primeiro.</em>";
    return;
  }
  let html = "";
  for (const s of knownSkills) {
    html += `<label><input type="checkbox" value="${s.id}" /> ${s.name}</label>`;
  }
  container.innerHTML = html;
}

function renderSkillSelect() {
  for (const id of ["skill-select", "revoke-skill-select"]) {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = '<option value="">Selecione...</option>';
    for (const s of knownSkills) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
    if (current) select.value = current;
  }
}

async function loadThreshold() {
  try {
    const cfg = await api("/api/config");
    currentThreshold = cfg.skill_threshold;
    document.getElementById("current-threshold").textContent = currentThreshold;
  } catch {}
}

function renderInstCertTypes() {
  const container = document.getElementById("inst-cert-types-list");
  if (knownCertTypes.length === 0) {
    container.innerHTML = "<em>Nenhum tipo de certificado criado ainda.</em>";
    updateBadgeCertSelect();
    updateSignersCertSelect();
    return;
  }
  let html = "";
  for (const c of knownCertTypes) {
    html += `<div class="cert-item">`;
    html += `<div class="cert-name">${c.name} (id: ${c.id})</div>`;
    const skillNames = c.required_skills.map((id) => knownSkills.find((s) => s.id === id)?.name || `#${id}`);
    html += `<div class="cert-status">Skills: ${skillNames.join(", ")}</div>`;
    html += `<div class="cert-status">Signers: ${c.required_signers.length ? c.required_signers.join(", ") : "nenhum"}</div>`;
    html += `</div>`;
  }
  container.innerHTML = html;
  updateBadgeCertSelect();
  updateSignersCertSelect();
}

function updateBadgeCertSelect() {
  const select = document.getElementById("signers-cert-select");
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const c of knownCertTypes) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (id: ${c.id})`;
    select.appendChild(opt);
  }
  const revokeSelect = document.getElementById("revoke-cert-select");
  revokeSelect.innerHTML = '<option value="">Selecione...</option>';
  for (const c of knownCertTypes) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (id: ${c.id})`;
    revokeSelect.appendChild(opt);
  }
}

function updateSignersCertSelect() {
  const container = document.getElementById("signers-checkboxes");
  container.innerHTML = "<em>Selecione um certificado.</em>";
}

async function renderSignersCheckboxes() {
  const container = document.getElementById("signers-checkboxes");
  const certTypeId = document.getElementById("signers-cert-select").value;
  if (!certTypeId) { container.innerHTML = "<em>Selecione um certificado.</em>"; return; }
  const cert = knownCertTypes.find((c) => String(c.id) === String(certTypeId));
  const currentSigners = cert ? cert.required_signers : [];
  const allIssuers = ["institution1", "institution2"];
  let html = "";
  for (const issuer of allIssuers) {
    const checked = currentSigners.includes(issuer) ? "checked" : "";
    html += `<label><input type="checkbox" value="${issuer}" ${checked} /> ${issuer}</label>`;
  }
  container.innerHTML = html;
}

async function setThreshold(e) {
  e.preventDefault();
  const threshold = Number(document.getElementById("skill-threshold-input").value);
  if (!threshold || threshold < 1) return;
  try {
    await api("/api/config/threshold", { method: "POST", body: JSON.stringify({ threshold }) });
    currentThreshold = threshold;
    document.getElementById("current-threshold").textContent = threshold;
    log(`Threshold atualizado para ${threshold}`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function checkSignatures(e) {
  e.preventDefault();
  const did = document.getElementById("sign-student-did").value.trim();
  if (!did) return;
  const container = document.getElementById("sign-cert-list");
  container.innerHTML = "<em>Verificando pendências...</em>";
  const currentIssuer = currentRole;
  let html = "";
  let found = false;
  for (const c of knownCertTypes) {
    if (!c.required_signers.includes(currentIssuer)) continue;
    const check = await api(`/api/cert-types/${c.id}/check?student=${encodeURIComponent(did)}`);
    const missingForMe = (check.missing_for_signers || []).filter((m) => m.signer === currentIssuer);
    const skillNames = missingForMe.map((m) => knownSkills.find((s) => s.id === m.skillId)?.name || `#${m.skillId}`);
    found = true;
    const signed = missingForMe.length === 0;
    html += `<div class="cert-item">`;
    html += `<div class="cert-name">${c.name} (id: ${c.id})</div>`;
    if (signed) {
      html += `<div class="cert-status complete">✓ Assinado — todas as skills emitidas</div>`;
    } else {
      html += `<div class="cert-status pending-sign">⏳ Pendente — falta emitir: ${skillNames.join(", ")}</div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = found ? html : "<em>Você não é signatário obrigatório de nenhum certificado.</em>";
}

window.signCertificate = async (certTypeId, studentDidArg) => {
  log(`Assinando certificado id=${certTypeId} — emitindo skills pendentes...`);
  const cert = knownCertTypes.find((c) => String(c.id) === String(certTypeId));
  if (!cert) return;
  const check = await api(`/api/cert-types/${certTypeId}/check?student=${encodeURIComponent(studentDidArg)}`);
  const missingForMe = (check.missing_for_signers || []).filter((m) => m.signer === currentRole);
  for (const m of missingForMe) {
    try {
      await api(`/api/skills/${m.skillId}/issue`, { method: "POST", body: JSON.stringify({ studentDid: studentDidArg }) });
      log(`Skill #${m.skillId} emitida`, "success");
    } catch (err) { log(`Erro: ${err.message}`, "error"); }
  }
  log(`Certificado "${cert.name}" assinado!`, "success");
  document.getElementById("sign-cert-form").dispatchEvent(new Event("submit"));
};

async function setSigners(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("signers-cert-select").value;
  if (!certTypeId) return;
  const checked = Array.from(document.querySelectorAll("#signers-checkboxes input:checked")).map((cb) => cb.value);
  try {
    await api(`/api/cert-types/${certTypeId}/signers`, { method: "POST", body: JSON.stringify({ required_signers: checked }) });
    log(`Signatários definidos: ${checked.join(", ")}`, "success");
    await loadAll();
    renderInstCertTypes();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function createSkill(e) {
  e.preventDefault();
  const name = document.getElementById("new-skill-name").value.trim();
  if (!name) return;
  try {
    const result = await api("/api/skills", { method: "POST", body: JSON.stringify({ name }) });
    log(`Skill "${name}" criada (id=${result.id})`, "success");
    await loadAll();
    renderSkillCheckboxes();
    renderSkillSelect();
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function issueSkill(e) {
  e.preventDefault();
  const did = document.getElementById("skill-student-did").value.trim();
  const skillId = document.getElementById("skill-select").value;
  if (!did || !skillId) return;
  try {
    const result = await api(`/api/skills/${skillId}/issue`, { method: "POST", body: JSON.stringify({ studentDid: did }) });
    log(`Skill #${skillId} emitida para ${shortId(did)}${result.duplicate ? " (já existia)" : ""}`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function createCertType(e) {
  e.preventDefault();
  const certName = document.getElementById("cert-name").value.trim();
  const checked = Array.from(document.querySelectorAll("#cert-skills-select input:checked")).map((cb) => Number(cb.value));
  if (!certName || checked.length === 0) { log("Preencha nome e selecione skills.", "error"); return; }
  try {
    await api("/api/cert-types", { method: "POST", body: JSON.stringify({ name: certName, required_skills: checked }) });
    log(`Certificado "${certName}" criado!`, "success");
    await loadAll();
    renderSkillCheckboxes();
    renderInstCertTypes();
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function revokeSkill(e) {
  e.preventDefault();
  const did = document.getElementById("revoke-skill-student-did").value.trim();
  const skillId = document.getElementById("revoke-skill-select").value;
  if (!did || !skillId) return;
  try {
    await api(`/api/skills/${skillId}/revoke`, { method: "POST", body: JSON.stringify({ studentDid: did }) });
    log(`Skill #${skillId} revogada para ${shortId(did)}`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function revokeCert(e) {
  e.preventDefault();
  const did = document.getElementById("revoke-student-did").value.trim();
  const certTypeId = document.getElementById("revoke-cert-select").value;
  if (!did || !certTypeId) return;
  try {
    await api(`/api/cert-types/${certTypeId}/revoke`, { method: "POST", body: JSON.stringify({ studentDid: did }) });
    log(`Certificado #${certTypeId} revogado para ${shortId(did)}`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function refreshSkills() {
  const container = document.getElementById("all-skills-list");
  if (!studentDid) { container.innerHTML = "<em>Gere seu DID primeiro.</em>"; return; }
  if (knownSkills.length === 0) { container.innerHTML = "<em>Nenhuma skill conhecida no sistema.</em>"; return; }
  try {
    const data = await api(`/api/students/${encodeURIComponent(studentDid)}/skills`);
    currentThreshold = data.threshold;
    let html = "";
    for (const s of data.skills) {
      const cls = s.has_skill ? "obtained" : "pending";
      const badge = s.has_skill ? '<span class="badge obtained">Obtida</span>' : '<span class="badge available">Faltante</span>';
      html += `<div class="skill-item ${cls}"><span class="skill-name">${s.name}</span><span class="attest-count">${s.attestation_count}/${data.threshold} assinaturas</span>${badge}</div>`;
    }
    container.innerHTML = html;
  } catch (err) { container.innerHTML = `<em>Erro: ${err.message}</em>`; }
}

async function refreshCertTypes() {
  const container = document.getElementById("cert-types-list");
  if (!studentDid) { container.innerHTML = "<em>Gere seu DID primeiro.</em>"; return; }
  if (knownCertTypes.length === 0) { container.innerHTML = "<em>Nenhum certificado criado ainda.</em>"; return; }
  const claimedData = await api(`/api/students/${encodeURIComponent(studentDid)}/certificates`);
  const claimedIds = new Set(claimedData.filter((c) => !c.revoked).map((c) => c.cert_type_id));
  let html = "";
  let found = false;
  for (const c of knownCertTypes) {
    if (claimedIds.has(c.id)) continue;
    found = true;
    const check = await api(`/api/cert-types/${c.id}/check?student=${encodeURIComponent(studentDid)}`);
    const canClaimNow = check.ok;
    html += `<div class="cert-item">`;
    html += `<div class="cert-name">${c.name} (id: ${c.id})</div>`;
    if (canClaimNow) {
      html += `<div class="cert-status complete">Todos os requisitos cumpridos!</div>`;
    } else {
      html += `<div class="cert-status">${check.reason}</div>`;
    }
    html += `<button onclick="claimCert(${c.id})">Reivindicar</button>`;
    html += `</div>`;
  }
  container.innerHTML = found ? html : "<em>Nenhum certificado pendente.</em>";
}

window.claimCert = async (certTypeId) => {
  log(`Reivindicando certificado id=${certTypeId}...`);
  try {
    const result = await api(`/api/cert-types/${certTypeId}/claim`, { method: "POST", body: JSON.stringify({ studentDid }) });
    log(`Certificado reivindicado! jti=${shortId(result.jti || "existing")}`, "success");
    refreshCertTypes();
    refreshClaimedCerts();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
};

async function refreshClaimedCerts() {
  const container = document.getElementById("claimed-certs-list");
  if (!studentDid) { container.innerHTML = "<em>Gere seu DID primeiro.</em>"; return; }
  try {
    const data = await api(`/api/students/${encodeURIComponent(studentDid)}/certificates`);
    if (data.length === 0) { container.innerHTML = "<em>Nenhum certificado reivindicado ainda.</em>"; return; }
    let html = "";
    for (const c of data) {
      const certType = knownCertTypes.find((ct) => ct.id === c.cert_type_id);
      const name = certType ? certType.name : `#${c.cert_type_id}`;
      const status = c.revoked ? '<div class="cert-status" style="color:#e74c3c">Revogado</div>' : '<div class="cert-status complete">Reivindicado</div>';
      html += `<div class="cert-item claimed"><div class="cert-name">${name}</div>${status}<div class="cert-status" style="font-size:0.7rem">jti: ${shortId(c.jti)}</div></div>`;
    }
    container.innerHTML = html;
  } catch (err) { container.innerHTML = `<em>Erro: ${err.message}</em>`; }
}

document.getElementById("role").addEventListener("change", (e) => switchView(e.target.value));
document.getElementById("create-skill-form").addEventListener("submit", createSkill);
document.getElementById("issue-skill-form").addEventListener("submit", issueSkill);
document.getElementById("create-cert-form").addEventListener("submit", createCertType);
document.getElementById("refresh-skills").addEventListener("click", refreshSkills);
document.getElementById("refresh-cert-skills").addEventListener("click", renderSkillCheckboxes);
document.getElementById("refresh-inst-certs").addEventListener("click", async () => { await loadAll(); renderInstCertTypes(); });
document.getElementById("revoke-cert-form").addEventListener("submit", revokeCert);
document.getElementById("revoke-skill-form").addEventListener("submit", revokeSkill);
document.getElementById("set-threshold-form").addEventListener("submit", setThreshold);
document.getElementById("set-signers-form").addEventListener("submit", setSigners);
document.getElementById("sign-cert-form").addEventListener("submit", checkSignatures);
document.getElementById("refresh-sign-certs").addEventListener("click", () => {
  const form = document.getElementById("sign-cert-form");
  if (document.getElementById("sign-student-did").value.trim()) form.dispatchEvent(new Event("submit"));
});
document.getElementById("signers-cert-select").addEventListener("change", renderSignersCheckboxes);
document.getElementById("refresh-cert-types").addEventListener("click", refreshCertTypes);
document.getElementById("refresh-claimed").addEventListener("click", refreshClaimedCerts);
document.getElementById("regen-did").addEventListener("click", () => {
  localStorage.removeItem("ob3_student_priv");
  refreshStudentDid();
  log("Novo DID gerado.", "success");
});
document.querySelector('[data-copy="student-did"]').addEventListener("click", async (e) => {
  e.preventDefault();
  if (!studentDid) refreshStudentDid();
  const did = document.getElementById("skill-student-did").value.trim() || document.getElementById("sign-student-did").value.trim() || studentDid;
  if (await copyToClipboard(did)) flashCopied(e.currentTarget);
});
document.getElementById("copy-did-box").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!studentDid) refreshStudentDid();
  if (await copyToClipboard(studentDid)) flashCopied(e.currentTarget);
});

// Auto-refresh das listas do aluno (o backend muda quando emite/revoga em outro role/aba)
async function refreshStudentView() {
  if (currentRole !== "student" || !studentDid) return;
  await Promise.all([refreshSkills(), refreshCertTypes(), refreshClaimedCerts()]);
}
setInterval(refreshStudentView, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshStudentView(); });
window.addEventListener("focus", refreshStudentView);

// Init
refreshStudentDid();
updateWalletInfo();
loadAll().then(() => {
  renderSkillCheckboxes();
  renderSkillSelect();
  renderInstCertTypes();
  loadThreshold();
  log(`Estado carregado: ${knownSkills.length} skill(s), ${knownCertTypes.length} certificado(s)`, "info");
});
