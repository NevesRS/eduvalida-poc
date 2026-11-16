const API = "/wallet-api";

let token = localStorage.getItem("wallet_token") || null;
let user = null;
let wallet = null;

function log(msg, type = "info") {
  const el = document.getElementById("log-entries");
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(entry);
}

function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

async function copyToClipboard(text) {
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

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function renderAuthState() {
  const authView = document.getElementById("auth-view");
  const walletView = document.getElementById("wallet-view");
  const adminView = document.getElementById("admin-view");
  const info = document.getElementById("wallet-info");
  const copyBtn = document.getElementById("copy-wallet");
  const logoutBtn = document.getElementById("logout-btn");
  if (token && user?.role === "admin") {
    authView.style.display = "none";
    walletView.style.display = "none";
    adminView.style.display = "block";
    info.textContent = `${user.username} (admin)`;
    copyBtn.style.display = "none";
    logoutBtn.style.display = "";
    loadAdmin();
  } else if (token && wallet) {
    authView.style.display = "none";
    walletView.style.display = "block";
    adminView.style.display = "none";
    info.textContent = `${shortAddr(wallet.address)} (${user?.username}${user?.role ? ", " + user.role : ""})`;
    copyBtn.style.display = "";
    logoutBtn.style.display = "";
    copyBtn.onclick = async () => {
      if (await copyToClipboard(wallet.address)) flashCopied(copyBtn);
    };
    loadMe();
  } else {
    authView.style.display = "block";
    walletView.style.display = "none";
    adminView.style.display = "none";
    info.textContent = "não autenticado";
    copyBtn.style.display = "none";
    logoutBtn.style.display = "none";
  }
}

function detailsHtml(data) {
  const w = data.wallet;
  const owner = data.onChainOwner && data.onChainOwner !== "0x" + "0".repeat(64)
    ? `<span class="badge obtained">registrada on-chain</span>` : `<span class="badge available">não registrada</span>`;
  const issuerBadge = data.isIssuer
    ? `<div class="cert-status"><span class="badge obtained">emissor autorizado on-chain</span></div>` : "";
  return `
    <div class="cert-item"><div class="cert-name">${w.address}</div>
      <div class="cert-status">usuário: ${data.user.username} · perfil: ${data.user.role}</div>
      <div class="cert-status">WalletRegistry: ${owner}</div>
      ${issuerBadge}
    </div>`;
}

async function loadMe() {
  const box = document.getElementById("wallet-details");
  try {
    const data = await api("/me");
    user = data.user;
    wallet = data.wallet;
    box.innerHTML = detailsHtml(data);
    applyRoleUI(data);
  } catch (e) {
    if (res401(e)) { token = null; wallet = null; renderAuthState(); return; }
    box.innerHTML = `<em>Erro: ${e.message}</em>`;
  }
}

// Visibilidade dos cards conforme o papel autenticado
function applyRoleUI(data) {
  const role = data.user.role;
  const isIssuer = !!data.isIssuer;
  const show = (id, cond) => {
    const el = document.getElementById(id);
    if (el) el.style.display = cond ? "" : "none";
  };
  show("card-issuer-pending", role === "institution" && !isIssuer);
  show("card-issue-skill", role === "institution" && isIssuer);
  show("card-consent", role === "student");
  show("card-issue-cert", role === "institution" && isIssuer);
  show("card-revoke", role === "institution");
  show("card-sign-cert", role === "institution");
  show("card-my-skills", role === "student");
  show("card-my-certs", role === "student");
  if (role === "student") { refreshMySkills(); refreshMyCerts(); }
}

function res401(e) {
  return String(e.message).includes("401") || String(e.message).toLowerCase().includes("token");
}

// ===== Auth =====
async function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById("register-username").value.trim();
  const password = document.getElementById("register-password").value;
  const role = document.getElementById("register-role").value;
  try {
    log(`Registrando "${username}" (${role}) e vinculando carteira na blockchain...`);
    const data = await api("/auth/register", { method: "POST", body: JSON.stringify({ username, password, role }) });
    token = data.token; user = data.user; wallet = data.wallet;
    localStorage.setItem("wallet_token", token);
    log(`Carteira ${shortAddr(wallet.address)} gerada e registrada on-chain (tx ${shortAddr(data.registration.txHash)}, bloco ${data.registration.blockNumber})`, "success");
    renderAuthState();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    token = data.token; user = data.user; wallet = data.wallet;
    localStorage.setItem("wallet_token", token);
    log(`Autenticado como "${username}" — chaves disponíveis`, "success");
    renderAuthState();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

function doLogout() {
  token = null; user = null; wallet = null;
  localStorage.removeItem("wallet_token");
  log("Sessão encerrada.");
  renderAuthState();
}

// ===== Assinar mensagem =====
// ===== Fluxo real: skills/cert types =====
async function loadChainCatalog() {
  try {
    const [skills, certTypes] = await Promise.all([api("/chain/skills"), api("/chain/cert-types")]);
    fillSelect("issue-skill-select", skills.map((s) => ({ value: s.skillType, label: s.name })));
    fillSelect("attestations-skill-select", skills.map((s) => ({ value: s.skillType, label: s.name })));
    const certOptions = certTypes.map((c) => ({ value: c.id, label: `${c.name} (id: ${c.id}, BurnAuth: ${c.burnAuthName})` }));
    fillSelect("consent-cert-select", certOptions);
    fillSelect("issue-cert-select", certOptions);
    fillSelect("revoke-cert-select", certOptions);
    fillSelect("sign-cert-select", certOptions);
  } catch (err) {
    log(`Catálogo on-chain indisponível: ${err.message}`, "error");
  }
}

function fillSelect(id, items) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    select.appendChild(opt);
  }
}

async function doIssueSkill(e) {
  e.preventDefault();
  const skillType = document.getElementById("issue-skill-select").value;
  const student = document.getElementById("issue-skill-student").value.trim();
  const box = document.getElementById("issue-skill-result");
  try {
    log(`Emitindo skill com a carteira autenticada (${shortAddr(wallet.address)})...`);
    const data = await api("/chain/issue-skill", { method: "POST", body: JSON.stringify({ student, skillType }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Skill emitida</div>
      <div class="cert-status">tx: ${shortAddr(data.txHash)} · bloco ${data.blockNumber}</div>
      <div class="cert-status">emissor: ${shortAddr(data.issuer)} (sua carteira)</div></div>`;
    log(`Skill emitida on-chain por ${shortAddr(data.issuer)}`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function doAttestations(e) {
  e.preventDefault();
  const student = document.getElementById("attestations-student").value.trim();
  const skillType = document.getElementById("attestations-skill-select").value;
  const box = document.getElementById("attestations-result");
  try {
    const data = await api(`/chain/attestations/${student}/${skillType}`);
    let html = `<div class="cert-item"><div class="cert-name">${data.count}/${data.threshold} atestados</div>`;
    if (data.attestations.length === 0) {
      html += `<div class="cert-status">Ninguém atestou ainda.</div>`;
    } else {
      for (const a of data.attestations) {
        const who = a.username ? `${a.username} (${shortAddr(a.issuer)})` : `${shortAddr(a.issuer)}${a.registered ? "" : " — sem vínculo"}`;
        html += `<div class="cert-status">✓ ${who}</div>`;
      }
    }
    box.innerHTML = html + `</div>`;
    log(`Atestados consultados: ${data.count}/${data.threshold}`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

// ===== EIP-5484: consentimento + emissão consensual + revogação =====
async function doConsent(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("consent-cert-select").value;
  let issuer = document.getElementById("consent-cert-issuer").value.trim();
  const box = document.getElementById("consent-cert-result");
  try {
    if (!issuer) {
      // autofill: primeiro emissor autorizado on-chain
      const issuers = await api("/chain/authorized-issuers");
      if (issuers.length === 0) throw new Error("nenhum emissor autorizado para o consentimento");
      issuer = issuers[0].address;
      document.getElementById("consent-cert-issuer").value = issuer;
    }
    log(`Assinando consentimento EIP-5484 para o certificado #${certTypeId}...`);
    const data = await api("/sign/consent", { method: "POST", body: JSON.stringify({ certTypeId, issuer }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Consentimento assinado</div>
      <div class="cert-status" style="word-break:break-all">digest: ${data.digest}</div>
      <div class="cert-status" style="word-break:break-all">assinatura: ${data.signature}</div></div>`;
    const issueStudent = document.getElementById("issue-cert-student");
    if (issueStudent && !issueStudent.value) issueStudent.value = wallet.address;
    document.getElementById("issue-cert-consent").value = data.signature;
    document.getElementById("issue-cert-select").value = String(data.certTypeId);
    log(`Consentimento do certificado #${certTypeId} assinado por ${shortAddr(data.student)}`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function doIssueCert(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("issue-cert-select").value;
  const student = document.getElementById("issue-cert-student").value.trim();
  const consentSignature = document.getElementById("issue-cert-consent").value.trim();
  const box = document.getElementById("issue-cert-result");
  try {
    log(`Emitindo certificado consensual (EIP-5484) com a carteira autenticada...`);
    const data = await api("/chain/issue-cert", { method: "POST", body: JSON.stringify({ certTypeId, student, consentSignature }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Certificado consensual emitido</div>
      <div class="cert-status">tx: ${shortAddr(data.txHash)} · bloco ${data.blockNumber}</div>
      <div class="cert-status">tokenId: ${data.tokenId} · BurnAuth: ${data.burnAuth}</div>
      <div class="cert-status">emissor: ${shortAddr(data.issuer)} · aluno: ${shortAddr(data.student)}</div></div>`;
    log(`Certificado #${certTypeId} emitido ao aluno ${shortAddr(data.student)} (tokenId ${data.tokenId})`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function doRevokeCert(e) {
  e.preventDefault();
  const student = document.getElementById("revoke-student-addr").value.trim();
  const certTypeId = document.getElementById("revoke-cert-select").value;
  const box = document.getElementById("revoke-cert-result");
  try {
    log(`Revogando certificado #${certTypeId} do aluno ${shortAddr(student)} — contrato valida o BurnAuth...`);
    const data = await api("/chain/revoke-cert", { method: "POST", body: JSON.stringify({ student, certTypeId }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Certificado revogado</div>
      <div class="cert-status">tx: ${shortAddr(data.txHash)} · tokenId ${data.tokenId} (resolvido por aluno+tipo)</div></div>`;
    log(`Certificado tipo ${data.certTypeId} revogado (tokenId ${data.tokenId})`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

// ===== Consultas: falta de signatários =====
async function doSignCert(e) {
  e.preventDefault();
  const student = document.getElementById("sign-student-addr").value.trim();
  const certTypeId = document.getElementById("sign-cert-select").value;
  const box = document.getElementById("sign-cert-result");
  try {
    const data = await api(`/chain/missing-signers/${student}/${certTypeId}`);
    let html = `<div class="cert-item"><div class="cert-name">${data.allSigned ? "✓ Todos os signatários cumpriram" : "⏳ Signatários pendentes"}</div>`;
    for (const m of data.missing) {
      html += `<div class="cert-status">⏳ falta: ${m.username || shortAddr(m.address)}</div>`;
    }
    for (const ms of data.missingSkills) {
      html += `<div class="cert-status">✗ skill faltante: ${ms.name}</div>`;
    }
    if (data.missing.length === 0 && data.missingSkills.length === 0) {
      html += `<div class="cert-status complete">Nada pendente para este aluno.</div>`;
    }
    box.innerHTML = html + `</div>`;
    log(`Consultados signatários pendentes do cert #${certTypeId}`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

// ===== Aluno: Minhas Skills / Meus Certificados =====
async function refreshMySkills() {
  const box = document.getElementById("my-skills-list");
  try {
    const data = await api("/me/skills");
    box.innerHTML = `<div class="cert-status">threshold: ${data.threshold} instituição(s) por skill · clique numa skill para ver quem atestou</div>` + data.skills.map((s) => `
      <div class="cert-item clickable" data-skill="${s.skillType}">
        <div class="cert-name">${s.name}</div>
        <div class="cert-status">${s.has
          ? `<span class="badge obtained">obtida</span> (${s.attestations}/${data.threshold})`
          : `<span class="badge available">faltante</span> (${s.attestations}/${data.threshold})`}</div>
        ${s.badgeUri ? `<div class="cert-status"><a href="${s.badgeUri}" target="_blank" class="badge-link">🏅 Badge</a></div>` : ""}
      </div>`).join("");
  } catch (e) { box.innerHTML = `<em>Erro: ${e.message}</em>`; }
}

async function refreshMyCerts() {
  const box = document.getElementById("my-certs-list");
  try {
    const data = await api("/me/certificates");
    if (data.certificates.length === 0) {
      box.innerHTML = `<em>Nenhum certificado emitido ainda.</em>`;
      return;
    }
    const rows = await Promise.all(data.certificates.map(async (c) => `
      <div class="cert-item claimed">
        <div class="cert-name">${c.name} ${c.badgeUri ? `<a href="${c.badgeUri}" target="_blank" class="badge-link">🏅 Badge</a>` : ""}</div>
        <div class="cert-status">tokenId: ${c.tokenId}</div>
        <div class="cert-status">emissor: ${await whoIsShort(c.issuer)}</div>
      </div>`));
    box.innerHTML = rows.join("");
  } catch (e) { box.innerHTML = `<em>Erro: ${e.message}</em>`; }
}

// Toggle "quem atestou" nas skills do aluno (validação criptográfica on-chain)
document.getElementById("my-skills-list").addEventListener("click", async (e) => {
  if (e.target.closest("a")) return; // não intercepta o link de Badge
  const item = e.target.closest(".cert-item.clickable");
  if (!item || !wallet) return;
  const existing = item.querySelector(".attest-detail");
  if (existing) { existing.remove(); return; }
  const skillType = item.getAttribute("data-skill");
  const detail = document.createElement("div");
  detail.className = "attest-detail cert-status";
  detail.textContent = "consultando quem atestou...";
  item.appendChild(detail);
  try {
    const data = await api(`/chain/attestations/${encodeURIComponent(wallet.address)}/${encodeURIComponent(skillType)}`);
    const rows = data.attestations.length === 0
      ? "ninguém atestou ainda"
      : data.attestations.map((a) =>
          `✓ ${a.username ? `${a.username} (${shortAddr(a.issuer)})` : `${shortAddr(a.issuer)}${a.registered ? "" : " — sem vínculo"}`}`
        ).join("<br>");
    detail.innerHTML = `quem atestou (${data.count}/${data.threshold}):<br>${rows}`;
  } catch (err) { detail.textContent = `erro: ${err.message}`; }
});

async function whoIsShort(addr) {
  try {
    const data = await api(`/chain/who/${addr}`);
    return data.username ? `${data.username} (${shortAddr(data.address)})` : shortAddr(data.address);
  } catch { return shortAddr(addr); }
}

// ===== Admin: autorização de emissores =====
async function loadAdmin() {
  const box = document.getElementById("admin-institutions");
  try {
    const rows = await api("/admin/institutions");
    if (rows.length === 0) {
      box.innerHTML = `<em>Nenhuma instituição registrada ainda.</em>`;
      return;
    }
    box.innerHTML = rows.map((r) => `
      <div class="cert-item">
        <div class="cert-name">${r.username}</div>
        <div class="cert-status">${r.address ? shortAddr(r.address) : "sem carteira"}</div>
        <div class="cert-status">status: ${r.authorized
          ? `<span class="badge obtained">autorizada</span>`
          : `<span class="badge available">não autorizada</span>`}</div>
        <div class="btn-row">
          <button class="small-btn" data-admin-action="authorize" data-user-id="${r.userId}" ${r.authorized ? "disabled" : ""}>Autorizar</button>
          <button class="small-btn" data-admin-action="revoke" data-user-id="${r.userId}" ${r.authorized ? "" : "disabled"}>Revogar</button>
        </div>
      </div>`).join("");
    for (const btn of box.querySelectorAll("[data-admin-action]")) {
      btn.addEventListener("click", () => adminToggleIssuer(btn));
    }
  } catch (e) {
    box.innerHTML = `<em>Erro: ${e.message}</em>`;
  }
  await loadAdminCatalog();
}

async function adminToggleIssuer(btn) {
  const userId = btn.dataset.userId;
  const action = btn.dataset.adminAction;
  try {
    log(`Admin: ${action === "authorize" ? "autorizando" : "revogando"} emissor...`);
    await api(`/admin/institutions/${userId}/${action}`, { method: "POST" });
    log(`Admin: emissor ${action === "authorize" ? "autorizado" : "revogado"} on-chain`, "success");
    loadAdmin();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

// ===== Admin: administração do catálogo (chaves internas no servidor) =====
// ===== Admin: administração do catálogo (chaves internas no servidor) =====
let adminInstitutions = [];

// Checkbox list de instituições para os signatários exigidos, pré-marcada com o estado atual do tipo
async function renderAdminSigners(certTypeId) {
  const box = document.getElementById("admin-signers-list");
  const rows = adminInstitutions.filter((i) => i.address);
  if (rows.length === 0) {
    box.innerHTML = "<em>Nenhuma instituição registrada ainda.</em>";
    return;
  }
  let current = new Set();
  if (certTypeId) {
    try {
      const data = await api(`/chain/cert-signers/${certTypeId}`);
      current = new Set((data.signers || []).map((s) => String(s).toLowerCase()));
    } catch {}
  }
  box.innerHTML = rows.map((i) =>
    `<label><input type="checkbox" value="${i.address}" ${current.has(i.address.toLowerCase()) ? "checked" : ""}/> ${i.username} (${shortAddr(i.address)})</label>`
  ).join("");
}

function fillAdminCertSelects(certTypes) {
  const opts = certTypes.map((c) => ({ value: c.id, label: `${c.name} (id: ${c.id}, BurnAuth: ${c.burnAuthName})` }));
  fillSelect("admin-signers-cert-select", opts);
  fillSelect("admin-cert-badge-select", opts);
  fillSelect("admin-delete-cert-select", opts);
  fillSelect("revoke-cert-select", opts);
  fillSelect("sign-cert-select", opts);
}

async function loadAdminCatalog() {
  try {
    const [skills, certTypes, institutions] = await Promise.all([
      api("/chain/skills"),
      api("/chain/cert-types"),
      api("/admin/institutions"),
    ]);
    adminInstitutions = institutions;
    const skillOpts = skills.map((s) => ({ value: s.skillType, label: s.name }));
    fillSelect("admin-skill-badge-select", skillOpts);
    const box = document.getElementById("admin-cert-skills");
    if (skills.length === 0) {
      box.innerHTML = "<em>Nenhuma skill conhecida. Crie uma skill primeiro.</em>";
    } else {
      box.innerHTML = skills.map((s) => `<label><input type="checkbox" value="${s.skillType}" /> ${s.name}</label>`).join("");
    }
    fillAdminCertSelects(certTypes);
    const sel = document.getElementById("admin-signers-cert-select");
    await renderAdminSigners(sel.value);
    // admin não tem carteira — threshold vem do estado on-chain público (/chain/health)
    const health = await api("/chain/health");
    document.getElementById("admin-current-threshold").textContent = String(health.threshold);
  } catch (err) {
    log(`Catálogo admin indisponível: ${err.message}`, "error");
  }
}

async function adminCreateSkill(e) {
  e.preventDefault();
  const name = document.getElementById("admin-skill-name").value.trim();
  const box = document.getElementById("admin-skill-result");
  try {
    log(`Admin: criando skill "${name}"...`);
    const data = await api("/chain/create-skill", { method: "POST", body: JSON.stringify({ name }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Skill criada</div>
      <div class="cert-status">skillType: ${data.skillType}</div></div>`;
    log(`Skill "${name}" criada no catálogo (tx ${shortAddr(data.txHash)})`, "success");
    e.target.reset();
    loadAdminCatalog();
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function adminCreateCertType(e) {
  e.preventDefault();
  const name = document.getElementById("admin-cert-name").value.trim();
  const burnAuth = Number(document.getElementById("admin-cert-burn-auth").value);
  const checked = document.querySelectorAll("#admin-cert-skills input[type='checkbox']:checked");
  const skills = Array.from(checked).map((cb) => cb.value);
  const box = document.getElementById("admin-cert-result");
  if (skills.length === 0) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ selecione ao menos uma skill</div>`; return; }
  try {
    log(`Admin: criando tipo de certificado "${name}" (BurnAuth=${burnAuth})...`);
    const data = await api("/chain/create-cert-type", { method: "POST", body: JSON.stringify({ name, skills, burnAuth }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Tipo de certificado criado</div>
      <div class="cert-status">id: ${data.id} · BurnAuth: ${data.burnAuthName}</div></div>`;
    log(`Certificado "${name}" criado (id ${data.id})`, "success");
    e.target.reset();
    loadAdminCatalog();
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function adminSetThreshold(e) {
  e.preventDefault();
  const threshold = Number(document.getElementById("admin-threshold-input").value);
  try {
    log(`Admin: definindo threshold=${threshold}...`);
    await api("/admin/skill-threshold", { method: "POST", body: JSON.stringify({ threshold }) });
    document.getElementById("admin-current-threshold").textContent = String(threshold);
    log(`Threshold atualizado para ${threshold}`, "success");
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function adminSetSigners(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("admin-signers-cert-select").value;
  const signers = Array.from(document.querySelectorAll("#admin-signers-list input[type='checkbox']:checked")).map((cb) => cb.value);
  const box = document.getElementById("admin-signers-result");
  try {
    log(`Admin: definindo ${signers.length} signatário(s) para o cert #${certTypeId}...`);
    await api(`/admin/cert-type/${certTypeId}/required-signers`, { method: "POST", body: JSON.stringify({ signers }) });
    box.innerHTML = `<div class="cert-item claimed"><div class="cert-name">✓ Signatários atualizados</div>
      <div class="cert-status">${signers.length ? "exigência: " + signers.map((s) => adminInstitutions.find((i) => i.address === s)?.username || shortAddr(s)).join(", ") : "sem exigência de signatários"}</div></div>`;
    log(`Signatários do cert #${certTypeId} definidos`, "success");
  } catch (err) { box.innerHTML = `<div class="cert-status" style="color:#e74c3c">✗ ${err.message}</div>`; log(`Erro: ${err.message}`, "error"); }
}

async function adminSkillBadge(e) {
  e.preventDefault();
  const skillType = document.getElementById("admin-skill-badge-select").value;
  const uri = document.getElementById("admin-skill-badge-uri").value.trim();
  if (!skillType || !uri) return;
  try {
    log(`Admin: vinculando badge à skill...`);
    await api("/admin/skill-badge", { method: "POST", body: JSON.stringify({ skillType, uri }) });
    log(`Badge da skill vinculada`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function adminCertBadge(e) {
  e.preventDefault();
  const certTypeId = Number(document.getElementById("admin-cert-badge-select").value);
  const uri = document.getElementById("admin-cert-badge-uri").value.trim();
  if (!certTypeId || !uri) return;
  try {
    log(`Admin: vinculando badge ao certificado...`);
    await api("/admin/cert-badge", { method: "POST", body: JSON.stringify({ certTypeId, uri }) });
    log(`Badge do certificado vinculada`, "success");
    e.target.reset();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

async function adminDeleteCert(e) {
  e.preventDefault();
  const certTypeId = Number(document.getElementById("admin-delete-cert-select").value);
  if (!certTypeId) return;
  try {
    log(`Admin: deletando tipo de certificado #${certTypeId}...`);
    await api(`/admin/cert-type/${certTypeId}/delete`, { method: "POST" });
    log(`Tipo de certificado #${certTypeId} deletado`, "success");
    loadAdminCatalog();
  } catch (err) { log(`Erro: ${err.message}`, "error"); }
}

// ===== Init =====
document.getElementById("register-form").addEventListener("submit", doRegister);
document.getElementById("login-form").addEventListener("submit", doLogin);
document.getElementById("logout-btn").addEventListener("click", doLogout);



document.getElementById("lookup-form").addEventListener("submit", doLookup);
document.getElementById("refresh-me").addEventListener("click", loadMe);
document.getElementById("issue-skill-form").addEventListener("submit", doIssueSkill);
document.getElementById("attestations-form").addEventListener("submit", doAttestations);
document.getElementById("consent-cert-form").addEventListener("submit", doConsent);
document.getElementById("issue-cert-form").addEventListener("submit", doIssueCert);
document.getElementById("revoke-cert-form").addEventListener("submit", doRevokeCert);
document.getElementById("sign-cert-form").addEventListener("submit", doSignCert);
document.getElementById("refresh-my-skills").addEventListener("click", refreshMySkills);
document.getElementById("refresh-my-certs").addEventListener("click", refreshMyCerts);
document.getElementById("admin-skill-form").addEventListener("submit", adminCreateSkill);
document.getElementById("admin-cert-form").addEventListener("submit", adminCreateCertType);
document.getElementById("admin-threshold-form").addEventListener("submit", adminSetThreshold);
document.getElementById("admin-signers-form").addEventListener("submit", adminSetSigners);
document.getElementById("admin-skill-badge-form").addEventListener("submit", adminSkillBadge);
document.getElementById("admin-cert-badge-form").addEventListener("submit", adminCertBadge);
document.getElementById("admin-delete-cert-form").addEventListener("submit", adminDeleteCert);
document.getElementById("admin-refresh-skills").addEventListener("click", loadAdminCatalog);
document.getElementById("admin-signers-cert-select").addEventListener("change", (e) => renderAdminSigners(e.target.value));

async function init() {
  try {
    const health = await api("/chain/health");
    log(`Blockchain online: chainId=${health.chainId}, bloco=${health.blockNumber}, registry=${health.walletRegistry ? shortAddr(health.walletRegistry) : "ausente"}`, "success");
  } catch (err) {
    log(`Falha ao consultar a blockchain pelo módulo (${err.message}).`, "error");
    log("Causas prováveis: 1) 'npm run wallet:server' não está rodando (porta 3002); 2) Besu fora em http://localhost:8545.", "error");
  }
  await loadChainCatalog();
  renderAuthState();
}

init();
