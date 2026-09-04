import { ethers } from "ethers";
import deployedAddresses from "../deployed-addresses.json";

const RPC_URL = "http://localhost:8545";
const DEPLOYER_KEY = "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63";
const INSTITUTION_KEY = "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3";
const INSTITUTION2_KEY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";
const STUDENT_KEY = "0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f";

const SKILL_TOKEN_ABI = [
  "function authorizedIssuers(address) view returns (bool)",
  "function skillNames(bytes32) view returns (string)",
  "function skillBadgeURI(bytes32) view returns (string)",
  "function skillThreshold() view returns (uint256)",
  "function skillId(bytes32 skillType, address institution) pure returns (uint256)",
  "function createSkill(string name) returns (bytes32)",
  "function issueSkill(address to, bytes32 skillType) returns (uint256)",
  "function hasSkill(address holder, bytes32 skillType) view returns (bool)",
  "function hasSkillFrom(address issuer, address holder, bytes32 skillType) view returns (bool)",
  "function skillAttestationCount(address holder, bytes32 skillType) view returns (uint256)",
  "function setIssuer(address institution, bool status)",
  "function setSkillThreshold(uint256 threshold)",
  "function setSkillBadgeURI(bytes32 skillType, string uri)",
  "function getKnownSkillTypes() view returns (bytes32[])",
  "function getIssuersList() view returns (address[])",
  "event SkillCreated(bytes32 indexed skillType, string name)",
  "event SkillIssued(address indexed institution, address indexed to, bytes32 indexed skillType, uint256 id)",
  "event SkillBadgeURISet(bytes32 indexed skillType, string uri)",
  "event SkillThresholdUpdated(uint256 newThreshold)",
];

const CERT_EMITTER_ABI = [
  "function certificateTypes(uint256) view returns (string name, bool exists)",
  "function certificateBadgeURI(uint256) view returns (string)",
  "function getRequiredSkills(uint256 certTypeId) view returns (bytes32[])",
  "function getRequiredSigners(uint256 certTypeId) view returns (address[])",
  "function missingSkills(address student, uint256 certTypeId) view returns (bytes32[])",
  "function missingSigners(address student, uint256 certTypeId) view returns (address[])",
  "function allSignersSigned(address student, uint256 certTypeId) view returns (bool)",
  "function claimCertificate(uint256 certTypeId) returns (uint256)",
  "function createCertificateType(string name, bytes32[] requiredSkills) returns (uint256)",
  "function setCertificateBadgeURI(uint256 certTypeId, string uri)",
  "function setRequiredSigners(uint256 certTypeId, address[] signers)",
  "function owner() view returns (address)",
  "function nextCertTypeId() view returns (uint256)",
  "function getCertTypeIds() view returns (uint256[])",
  "function hasClaimed(address student, uint256 certTypeId) view returns (bool)",
  "function studentTokenId(address student, uint256 certTypeId) view returns (uint256)",
  "function revokeCertificate(uint256 tokenId)",
  "function deleteCertificateType(uint256 certTypeId)",
  "event CertificateTypeCreated(uint256 indexed certTypeId, string name)",
  "event CertificateClaimed(address indexed student, uint256 indexed certTypeId, uint256 tokenId)",
  "event CertificateBadgeURISet(uint256 indexed certTypeId, string uri)",
  "event RequiredSignersSet(uint256 indexed certTypeId, address[] signers)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

const wallets = {
  deployer: new ethers.Wallet(DEPLOYER_KEY, provider),
  institution: new ethers.Wallet(INSTITUTION_KEY, provider),
  institution2: new ethers.Wallet(INSTITUTION2_KEY, provider),
  student: new ethers.Wallet(STUDENT_KEY, provider),
};

const skillToken = new ethers.Contract(deployedAddresses.skillToken, SKILL_TOKEN_ABI, provider);
const certEmitter = new ethers.Contract(deployedAddresses.certificateEmitter, CERT_EMITTER_ABI, provider);

let currentRole = "institution";
let currentThreshold = 1;
const knownSkills = new Map();
const knownCertTypes = new Map();

function log(msg, type = "info") {
  const el = document.getElementById("log-entries");
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(entry);
}

function toBytes32(text) {
  return ethers.id(text);
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

function flashCopied(btn) {
  btn.classList.add("copied");
  btn.textContent = "✓";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = "⧉";
  }, 1200);
}

function updateWalletInfo() {
  const wallet = wallets[currentRole];
  const fullAddr = wallet.address;
  document.getElementById("wallet-info").textContent = `${shortAddr(fullAddr)} (${currentRole})`;
  document.getElementById("copy-wallet").onclick = async () => {
    await copyToClipboard(fullAddr);
    flashCopied(document.getElementById("copy-wallet"));
  };
}

function switchView(role) {
  currentRole = role;
  const isInstitution = role === "institution" || role === "institution2";
  document.getElementById("institution-view").style.display = isInstitution ? "block" : "none";
  document.getElementById("student-view").style.display = role === "student" ? "block" : "none";
  updateWalletInfo();
  if (isInstitution) {
    renderSkillCheckboxes();
    renderSkillSelect();
    renderInstCertTypes();
    renderRevokeCertSelect();
    loadThreshold();
  } else {
    refreshSkills();
    refreshCertTypes();
    refreshClaimedCerts();
  }
}

function renderSkillCheckboxes() {
  const container = document.getElementById("cert-skills-select");
  if (knownSkills.size === 0) {
    container.innerHTML = "<em>Nenhuma skill conhecida. Crie uma skill primeiro.</em>";
    return;
  }
  let html = "";
  for (const [hash, name] of knownSkills) {
    html += `<label><input type="checkbox" value="${hash}" /> ${name}</label>`;
  }
  container.innerHTML = html;
}

function renderSkillSelect() {
  const select = document.getElementById("skill-select");
  const current = select.value;
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const [hash, name] of knownSkills) {
    const opt = document.createElement("option");
    opt.value = hash;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if (current) select.value = current;

  // badge skill select
  const badgeSelect = document.getElementById("badge-skill-select");
  badgeSelect.innerHTML = '<option value="">Selecione...</option>';
  for (const [hash, name] of knownSkills) {
    const opt = document.createElement("option");
    opt.value = hash;
    opt.textContent = name;
    badgeSelect.appendChild(opt);
  }
}

async function loadThreshold() {
  try {
    currentThreshold = Number(await skillToken.skillThreshold());
    document.getElementById("current-threshold").textContent = currentThreshold;
  } catch {}
}

function renderInstCertTypes() {
  const container = document.getElementById("inst-cert-types-list");
  if (knownCertTypes.size === 0) {
    container.innerHTML = "<em>Nenhum tipo de certificado criado ainda.</em>";
    updateBadgeCertSelect();
    updateSignersCertSelect();
    return;
  }
  let html = "";
  for (const [id, info] of knownCertTypes) {
    html += `<div class="cert-item">`;
    html += `<div class="cert-name">${info.name} (id: ${id})</div>`;
    html += `<div class="cert-status">Skills: ${info.skills.join(", ")}</div>`;
    html += `<button onclick="deleteCertType(${id})" style="margin-top:0.4rem;font-size:0.75rem;background:#555">Excluir</button>`;
    html += `</div>`;
  }
  container.innerHTML = html;
  updateBadgeCertSelect();
  updateSignersCertSelect();
}

function updateBadgeCertSelect() {
  const select = document.getElementById("badge-cert-select");
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const [id, info] of knownCertTypes) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${info.name} (id: ${id})`;
    select.appendChild(opt);
  }
}

function updateSignersCertSelect() {
  const select = document.getElementById("signers-cert-select");
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const [id, info] of knownCertTypes) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${info.name} (id: ${id})`;
    select.appendChild(opt);
  }
  // limpar checkboxes ao trocar de cert
  document.getElementById("signers-checkboxes").innerHTML = "<em>Selecione um certificado.</em>";
}

async function renderSignersCheckboxes() {
  const container = document.getElementById("signers-checkboxes");
  const certTypeId = document.getElementById("signers-cert-select").value;
  if (!certTypeId) {
    container.innerHTML = "<em>Selecione um certificado.</em>";
    return;
  }

  // carregar signatários atuais
  let currentSigners = [];
  try {
    currentSigners = await certEmitter.getRequiredSigners(Number(certTypeId));
    currentSigners = currentSigners.map((s) => s.toLowerCase());
  } catch {}

  // listar todas as instituições do SkillToken
  let issuers = [];
  try {
    issuers = await skillToken.getIssuersList();
  } catch {}

  if (issuers.length === 0) {
    container.innerHTML = "<em>Nenhuma instituição autorizada.</em>";
    return;
  }

  let html = "";
  for (const addr of issuers) {
    const checked = currentSigners.includes(addr.toLowerCase()) ? "checked" : "";
    html += `<label><input type="checkbox" value="${addr}" ${checked} /> ${shortAddr(addr)}</label>`;
  }
  container.innerHTML = html;
}

async function setThreshold(e) {
  e.preventDefault();
  const threshold = Number(document.getElementById("skill-threshold-input").value);
  if (!threshold || threshold < 1) return;

  const signer = wallets.deployer;
  const contract = skillToken.connect(signer);

  log(`Definindo threshold de skills para ${threshold}...`);

  try {
    const tx = await contract.setSkillThreshold(threshold);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    currentThreshold = threshold;
    document.getElementById("current-threshold").textContent = threshold;
    log(`Threshold atualizado para ${threshold}!`, "success");
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function setSigners(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("signers-cert-select").value;
  if (!certTypeId) return;

  const checked = document.querySelectorAll("#signers-checkboxes input[type='checkbox']:checked");
  const signers = Array.from(checked).map((cb) => cb.value);

  const info = knownCertTypes.get(Number(certTypeId));
  const certName = info ? info.name : certTypeId;

  const signer = wallets.institution;
  const contract = certEmitter.connect(signer);

  log(`Definindo signatários para "${certName}" (${signers.length} signatários)...`);

  try {
    const tx = await contract.setRequiredSigners(Number(certTypeId), signers);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    log(`Signatários definidos com sucesso!`, "success");
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function deleteCertType(certTypeId) {
  const signer = wallets.institution;
  const contract = certEmitter.connect(signer);

  log(`Excluindo tipo de certificado id=${certTypeId}...`);

  try {
    const tx = await contract.deleteCertificateType(certTypeId);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    knownCertTypes.delete(certTypeId);
    log(`Tipo de certificado excluido!`, "success");
    renderInstCertTypes();
    renderRevokeCertSelect();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

window.deleteCertType = deleteCertType;

async function createSkill(e) {
  e.preventDefault();
  const name = document.getElementById("new-skill-name").value.trim();
  if (!name) return;

  const signer = wallets.deployer;
  const contract = skillToken.connect(signer);

  log(`Criando skill "${name}"...`);

  try {
    const tx = await contract.createSkill(name);
    log(`TX enviada: ${tx.hash}`, "info");
    const receipt = await tx.wait();

    for (const logItem of receipt.logs) {
      try {
        const parsed = skillToken.interface.parseLog(logItem);
        if (parsed.name === "SkillCreated") {
          knownSkills.set(parsed.args.skillType, parsed.args.name);
          log(`SkillCreated: ${parsed.args.name}`, "success");
        }
      } catch {}
    }

    log(`Skill "${name}" criada!`, "success");
    renderSkillCheckboxes();
    renderSkillSelect();
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function IssueSkill(e) {
  e.preventDefault();
  const studentAddr = document.getElementById("skill-student-addr").value.trim();
  const skillType = document.getElementById("skill-select").value;
  if (!studentAddr || !skillType) return;

  const skillName = knownSkills.get(skillType) || skillType;
  const signer = wallets[currentRole];
  const contract = skillToken.connect(signer);

  log(`Emitindo skill "${skillName}" para ${shortAddr(studentAddr)}...`);

  try {
    const tx = await contract.issueSkill(studentAddr, skillType);
    log(`TX enviada: ${tx.hash}`, "info");
    const receipt = await tx.wait();

    for (const logItem of receipt.logs) {
      try {
        const parsed = skillToken.interface.parseLog(logItem);
        if (parsed.name === "SkillIssued") {
          log(`SkillIssued: id=${parsed.args.id}`, "success");
        }
      } catch {}
    }

    log(`Skill "${skillName}" emitida com sucesso!`, "success");
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function createCertType(e) {
  e.preventDefault();
  const certName = document.getElementById("cert-name").value.trim();
  if (!certName) return;

  const checked = document.querySelectorAll("#cert-skills-select input[type='checkbox']:checked");
  const skillTypes = Array.from(checked).map((cb) => cb.value);
  if (skillTypes.length === 0) {
    log("Selecione ao menos uma skill.", "error");
    return;
  }

  const signer = wallets.institution;
  const contract = certEmitter.connect(signer);

  log(`Criando tipo de certificado "${certName}" com ${skillTypes.length} skill(s)...`);

  try {
    const tx = await contract.createCertificateType(certName, skillTypes);
    log(`TX enviada: ${tx.hash}`, "info");
    const receipt = await tx.wait();

    const skillNames = skillTypes.map((h) => knownSkills.get(h) || h);
    for (const logItem of receipt.logs) {
      try {
        const parsed = certEmitter.interface.parseLog(logItem);
        if (parsed.name === "CertificateTypeCreated") {
          const certTypeId = parsed.args.certTypeId;
          knownCertTypes.set(Number(certTypeId), { name: certName, skills: skillNames });
          log(`CertificateTypeCreated: id=${certTypeId}`, "success");
        }
      } catch {}
    }

    log(`Certificado "${certName}" criado!`, "success");
    e.target.reset();
    renderSkillCheckboxes();
    renderInstCertTypes();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function refreshSkills() {
  const container = document.getElementById("all-skills-list");

  if (knownSkills.size === 0) {
    container.innerHTML = "<em>Nenhuma skill conhecida no sistema.</em>";
    return;
  }

  container.innerHTML = "";
  const signer = wallets.student;
  const contract = skillToken.connect(signer);

  let threshold = 1;
  try { threshold = Number(await skillToken.skillThreshold()); } catch {}

  for (const [hash, name] of knownSkills) {
    const item = document.createElement("div");
    item.className = "skill-item";

    try {
      const has = await contract.hasSkill(signer.address, hash);
      const count = Number(await contract.skillAttestationCount(signer.address, hash));
      let badgeUri = "";
      try {
        badgeUri = await skillToken.skillBadgeURI(hash);
      } catch {}

      let badgeHtml;
      if (has) {
        item.classList.add("obtained");
        if (badgeUri) {
          badgeHtml = `<a href="${badgeUri}" target="_blank" class="badge-link" title="Open Badge">🏅 Badge</a>`;
        } else {
          badgeHtml = `<span class="badge obtained">Obtida</span>`;
        }
      } else {
        item.classList.add("pending");
        badgeHtml = `<span class="badge available">Faltante</span>`;
      }

      const countHtml = `<span class="attest-count">${count}/${threshold} assinaturas</span>`;
      item.innerHTML = `<span class="skill-name">${name}</span>${countHtml}${badgeHtml}`;
    } catch {
      item.classList.add("pending");
      item.innerHTML = `<span class="skill-name">${name}</span><span class="badge available">Erro</span>`;
    }

    container.appendChild(item);
  }
}

async function refreshCertTypes() {
  const container = document.getElementById("cert-types-list");
  container.innerHTML = "<em>Carregando certificados...</em>";

  if (knownCertTypes.size === 0) {
    container.innerHTML = "<em>Nenhum tipo de certificado conhecido. Crie um como instituição primeiro.</em>";
    return;
  }

  const signer = wallets.student;
  const skillContract = skillToken.connect(signer);
  const certContract = certEmitter.connect(signer);

  let html = "";
  for (const [id, info] of knownCertTypes) {
    try {
      const claimed = await certContract.hasClaimed(signer.address, id);
      if (claimed) continue;

      const requiredHashes = await certContract.getRequiredSkills(id);
      let obtained = 0;
      const total = requiredHashes.length;
      for (const hash of requiredHashes) {
        try {
          if (await skillContract.hasSkill(signer.address, hash)) obtained++;
        } catch {}
      }

      const missing = await certContract.missingSkills(signer.address, id);
      const skillsComplete = missing.length === 0;

      // signatários
      let signersOk = true;
      let signerHtml = "";
      try {
        const requiredSigners = await certContract.getRequiredSigners(id);
        if (requiredSigners.length > 0) {
          signersOk = await certContract.allSignersSigned(signer.address, id);
          const missingSigs = await certContract.missingSigners(signer.address, id);

          signerHtml += `<div class="signer-status">`;
          signerHtml += `<span class="signer-label">Signatários:</span> `;
          for (const sig of requiredSigners) {
            const isMissing = missingSigs.map((s) => s.toLowerCase()).includes(sig.toLowerCase());
            const icon = isMissing ? "⏳" : "✓";
            const cls = isMissing ? "signer-pending" : "signer-ok";
            signerHtml += `<span class="${cls}">${icon} ${shortAddr(sig)}</span> `;
          }
          signerHtml += `</div>`;
        }
      } catch {}

      html += `<div class="cert-item">`;
      html += `<div class="cert-name">${info.name} (id: ${id})</div>`;
      html += `<div class="cert-status">${obtained} de ${total} skills</div>`;
      html += signerHtml;

      if (skillsComplete && signersOk) {
        html += `<div class="cert-status complete">Todos os requisitos cumpridos!</div>`;
      } else {
        if (!skillsComplete) {
          const missingNames = missing.map((h) => knownSkills.get(h) || h.slice(0, 10) + "...");
          html += `<div class="missing-list">`;
          for (const n of missingNames) html += `<span>${n}</span>`;
          html += `</div>`;
        }
      }

      html += `<button onclick="claimCert(${id})">Reivindicar</button>`;
      html += `</div>`;
    } catch (err) {
      html += `<div class="cert-item"><div class="cert-name">${info.name}</div><div class="cert-status">Erro ao verificar</div></div>`;
    }
  }

  container.innerHTML = html || "<em>Nenhum certificado encontrado.</em>";
}

async function claimCert(certTypeId) {
  const signer = wallets.student;
  const contract = certEmitter.connect(signer);

  log(`Reivindicando certificado id=${certTypeId}...`);

  try {
    const tx = await contract.claimCertificate(certTypeId);
    log(`TX enviada: ${tx.hash}`, "info");
    const receipt = await tx.wait();

    for (const logItem of receipt.logs) {
      try {
        const parsed = certEmitter.interface.parseLog(logItem);
        if (parsed.name === "CertificateClaimed") {
          log(`CertificateClaimed: tokenId=${parsed.args.tokenId}`, "success");
        }
      } catch {}
    }

    log(`Certificado reivindicado com sucesso!`, "success");
    refreshCertTypes();
    refreshClaimedCerts();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

window.claimCert = claimCert;

async function refreshClaimedCerts() {
  const container = document.getElementById("claimed-certs-list");
  container.innerHTML = "<em>Verificando...</em>";

  if (knownCertTypes.size === 0) {
    container.innerHTML = "<em>Nenhum certificado criado ainda.</em>";
    return;
  }

  const signer = wallets.student;
  const contract = certEmitter.connect(signer);
  let html = "";
  let found = false;

  for (const [id, info] of knownCertTypes) {
    try {
      const claimed = await contract.hasClaimed(signer.address, id);
      if (claimed) {
        found = true;
        let badgeHtml = "";
        try {
          const badgeUri = await certEmitter.certificateBadgeURI(id);
          if (badgeUri) badgeHtml = `<a href="${badgeUri}" target="_blank" class="badge-link" title="Open Badge">🏅 Badge</a>`;
        } catch {}
        html += `<div class="cert-item claimed">`;
        html += `<div class="cert-name">${info.name} ${badgeHtml}</div>`;
        html += `<div class="cert-status complete">Reivindicado</div>`;
        html += `</div>`;
      }
    } catch {
      // skip
    }
  }

  container.innerHTML = found ? html : "<em>Nenhum certificado reivindicado ainda.</em>";
}

function renderRevokeCertSelect() {
  const select = document.getElementById("revoke-cert-select");
  select.innerHTML = '<option value="">Selecione...</option>';
  for (const [id, info] of knownCertTypes) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${info.name} (id: ${id})`;
    select.appendChild(opt);
  }
}

async function revokeCert(e) {
  e.preventDefault();
  const studentAddr = document.getElementById("revoke-student-addr").value.trim();
  const certTypeId = document.getElementById("revoke-cert-select").value;
  if (!studentAddr || !certTypeId) return;

  const signer = wallets.institution;
  const contract = certEmitter.connect(signer);

  try {
    const tokenId = await contract.studentTokenId(studentAddr, Number(certTypeId));
    if (tokenId === 0n) {
      log("Aluno nao possui esse certificado.", "error");
      return;
    }

    log(`Revogando certificado tokenId=${tokenId} do aluno ${shortAddr(studentAddr)}...`);

    const tx = await contract.revokeCertificate(tokenId);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    log(`Certificado revogado com sucesso!`, "success");
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function setSkillBadgeURI(e) {
  e.preventDefault();
  const skillType = document.getElementById("badge-skill-select").value;
  const uri = document.getElementById("skill-badge-uri").value.trim();
  if (!skillType || !uri) return;

  const skillName = knownSkills.get(skillType) || skillType;
  const signer = wallets.deployer;
  const contract = skillToken.connect(signer);

  log(`Vinculando Open Badge URI para skill "${skillName}"...`);

  try {
    const tx = await contract.setSkillBadgeURI(skillType, uri);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    log(`URI vinculada com sucesso!`, "success");
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function setCertBadgeURI(e) {
  e.preventDefault();
  const certTypeId = document.getElementById("badge-cert-select").value;
  const uri = document.getElementById("cert-badge-uri").value.trim();
  if (!certTypeId || !uri) return;

  const info = knownCertTypes.get(Number(certTypeId));
  const certName = info ? info.name : certTypeId;
  const signer = wallets.institution;
  const contract = certEmitter.connect(signer);

  log(`Vinculando Open Badge URI para certificado "${certName}"...`);

  try {
    const tx = await contract.setCertificateBadgeURI(Number(certTypeId), uri);
    log(`TX enviada: ${tx.hash}`, "info");
    await tx.wait();

    log(`URI vinculada com sucesso!`, "success");
    e.target.reset();
  } catch (err) {
    log(`Erro: ${err.reason || err.message}`, "error");
  }
}

async function loadFromChain() {
  try {
    const skillTypes = await skillToken.getKnownSkillTypes();
    for (const hash of skillTypes) {
      if (!knownSkills.has(hash)) {
        try {
          const name = await skillToken.skillNames(hash);
          knownSkills.set(hash, name || hash);
        } catch {
          knownSkills.set(hash, hash);
        }
      }
    }
  } catch (err) {
    console.error("Erro ao carregar skills:", err);
  }

  try {
    const ids = await certEmitter.getCertTypeIds();
    for (const bigId of ids) {
      const certTypeId = Number(bigId);
      if (!knownCertTypes.has(certTypeId)) {
        try {
          const cert = await certEmitter.certificateTypes(certTypeId);
          if (cert.exists) {
            const requiredSkills = await certEmitter.getRequiredSkills(certTypeId);
            const skillNames = [];
            for (const hash of requiredSkills) {
              skillNames.push(knownSkills.get(hash) || hash);
            }
            knownCertTypes.set(certTypeId, { name: cert.name, skills: skillNames });
          }
        } catch (err) {
          console.error(`Erro ao carregar cert tipo ${certTypeId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Erro ao carregar certificados:", err);
  }
}

document.getElementById("role").addEventListener("change", (e) => {
  switchView(e.target.value);
});

document.getElementById("create-skill-form").addEventListener("submit", createSkill);
document.getElementById("issue-skill-form").addEventListener("submit", IssueSkill);
document.getElementById("create-cert-form").addEventListener("submit", createCertType);
document.getElementById("refresh-skills").addEventListener("click", refreshSkills);
document.getElementById("refresh-cert-skills").addEventListener("click", renderSkillCheckboxes);
document.getElementById("refresh-inst-certs").addEventListener("click", async () => {
  knownCertTypes.clear();
  await loadFromChain();
  renderInstCertTypes();
  renderRevokeCertSelect();
});
document.getElementById("revoke-cert-form").addEventListener("submit", revokeCert);
document.getElementById("set-skill-badge-form").addEventListener("submit", setSkillBadgeURI);
document.getElementById("set-cert-badge-form").addEventListener("submit", setCertBadgeURI);
document.getElementById("set-threshold-form").addEventListener("submit", setThreshold);
document.getElementById("set-signers-form").addEventListener("submit", setSigners);
document.getElementById("signers-cert-select").addEventListener("change", renderSignersCheckboxes);
document.getElementById("refresh-cert-types").addEventListener("click", refreshCertTypes);
document.getElementById("refresh-claimed").addEventListener("click", refreshClaimedCerts);

document.querySelector('[data-copy="student-address"]').addEventListener("click", async (e) => {
  e.preventDefault();
  await copyToClipboard(wallets.student.address);
  flashCopied(e.currentTarget);
});

updateWalletInfo();
log("Conectado à rede Besu local via " + RPC_URL, "info");

loadFromChain().then(async () => {
  renderSkillCheckboxes();
  renderSkillSelect();
  renderInstCertTypes();
  renderRevokeCertSelect();
  await loadThreshold();
  refreshClaimedCerts();
  log(`Estado carregado: ${knownSkills.size} skill(s), ${knownCertTypes.size} certificado(s), threshold=${currentThreshold}`, "info");
});
