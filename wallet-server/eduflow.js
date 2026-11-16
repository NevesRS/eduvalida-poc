// Fluxo real (SkillToken + CertificateEmitter) com carteiras autenticadas do módulo 1:1.
// Cada emissão/reivindicação é uma transação assinada pela carteira do usuário autenticado —
// o atestado fica provado on-chain (msg.sender do tx) e o "quem pertence" resolve via WalletRegistry.
const { ethers, Wallet, id } = require("ethers");
const { provider, chainOwnerOf } = require("./chain");
const { SKILL_TOKEN_ADDRESS, CERT_EMITTER_ADDRESS, DEPLOYER_KEY, INSTITUTION_KEY } = require("./config");
const db = require("./db");

const SKILL_ABI = [
  "function authorizedIssuers(address) view returns (bool)",
  "function skillNames(bytes32) view returns (string)",
  "function skillBadgeURI(bytes32) view returns (string)",
  "function skillThreshold() view returns (uint256)",
  "function createSkill(string) returns (bytes32)",
  "function issueSkill(address,bytes32) returns (uint256)",
  "function hasSkill(address,bytes32) view returns (bool)",
  "function hasSkillFrom(address,address,bytes32) view returns (bool)",
  "function skillAttestationCount(address,bytes32) view returns (uint256)",
  "function setIssuer(address,bool)",
  "function setSkillThreshold(uint256)",
  "function setSkillBadgeURI(bytes32,string)",
  "function getKnownSkillTypes() view returns (bytes32[])",
  "function getIssuersList() view returns (address[])",
];

const CERT_ABI = [
  // Obs: o getter automático do struct público omite o campo bytes32[] — use getRequiredSkills().
  "function certificateTypes(uint256) view returns (string name, uint8 burnAuth, bool exists)",
  "function createCertificateType(string,bytes32[],uint8) returns (uint256)",
  "function getRequiredSkills(uint256) view returns (bytes32[])",
  "function getRequiredSigners(uint256) view returns (address[])",
  "function missingSigners(address,uint256) view returns (address[])",
  "function allSignersSigned(address,uint256) view returns (bool)",
  "function hasClaimed(address,uint256) view returns (bool)",
  "function issueCertificate(uint256,address,bytes) returns (uint256)",
  "function revokeCertificate(uint256)",
  "function burnAuth(uint256) view returns (uint8)",
  "function tokenIssuer(uint256) view returns (address)",
  "function certificateBadgeURI(uint256) view returns (string)",
  "function getCertTypeIds() view returns (uint256[])",
  "function studentTokenId(address,uint256) view returns (uint256)",
];

const skillToken = new ethers.Contract(SKILL_TOKEN_ADDRESS, SKILL_ABI, provider);
const certEmitter = new ethers.Contract(CERT_EMITTER_ADDRESS, CERT_ABI, provider);
const deployer = new Wallet(DEPLOYER_KEY, provider);
const contractOwner = new Wallet(INSTITUTION_KEY, provider);

const BURN_AUTH_NAMES = ["IssuerOnly", "OwnerOnly", "Both", "Neither"];

function requireContracts() {
  if (!SKILL_TOKEN_ADDRESS || !CERT_EMITTER_ADDRESS) {
    throw new Error("Contratos não deployados: rode npm run deploy");
  }
}

function audit({ userId, address, kind, txHash, valid = true }) {
  db.prepare("INSERT INTO signatures (user_id, address, kind, tx_hash, valid) VALUES (?, ?, ?, ?, ?)")
    .run(userId, address, kind, txHash, valid ? 1 : 0);
}

function usernameFor(address) {
  const row = db.prepare("SELECT u.username FROM users u JOIN wallets w ON w.user_id = u.id WHERE LOWER(w.address) = ?").get(String(address).toLowerCase());
  return row ? row.username : null;
}

function isZero32(hash) {
  return !hash || hash === "0x" + "0".repeat(64);
}

// ===== Deployer/owner (chaves de administração da POC) =====
async function createSkill(name) {
  requireContracts();
  const tx = await skillToken.connect(deployer).createSkill(name);
  const receipt = await tx.wait();
  const skillType = id(name); // keccak256(name) — igual ao contrato
  audit({ userId: null, address: deployer.address, kind: "create-skill", txHash: receipt.hash });
  return { skillType, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function createCertType(name, skills, burnAuth = 0) {
  requireContracts();
  const tx = await certEmitter.connect(contractOwner).createCertificateType(name, skills, burnAuth);
  const receipt = await tx.wait();
  const ids = await certEmitter.getCertTypeIds();
  const certTypeId = Number(ids[ids.length - 1]);
  audit({ userId: null, address: contractOwner.address, kind: "create-cert-type", txHash: receipt.hash });
  return { id: certTypeId, burnAuth, burnAuthName: BURN_AUTH_NAMES[burnAuth], txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

// ===== 1:1 aplicado ao fluxo real (carteira autenticada) =====

// Admin autoriza/revoga emissor (somente o admin da plataforma decide quem emite)
async function setIssuerState(targetAddress, status, adminUserId) {
  requireContracts();
  const ownerHash = await chainOwnerOf(targetAddress);
  if (isZero32(ownerHash)) {
    throw new Error("carteira não registrada no WalletRegistry: registre o vínculo carteira -> usuário antes de virar emissor");
  }
  const already = await skillToken.authorizedIssuers(targetAddress);
  if (already === status) return { already: true, txHash: null };
  const tx = await skillToken.connect(deployer).setIssuer(targetAddress, status);
  const receipt = await tx.wait();
  audit({ userId: adminUserId, address: targetAddress, kind: status ? "admin-authorize-issuer" : "admin-revoke-issuer", txHash: receipt.hash });
  return { already: false, status, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function issueSkill(wallet, userId, student, skillType) {
  requireContracts();
  const authorized = await skillToken.authorizedIssuers(wallet.address);
  if (!authorized) throw new Error("carteira autenticada não é emissor autorizado: o admin precisa autorizar esta instituição");
  const signer = wallet.connect(provider);
  const tx = await skillToken.connect(signer).issueSkill(student, skillType);
  const receipt = await tx.wait();
  audit({ userId, address: wallet.address, kind: "issue-skill", txHash: receipt.hash });
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, issuer: wallet.address };
}

// Emissão consensual (EIP-5484): a instituição (wallet autenticada) emite ao aluno,
// que assinou previamente o consentimento (validado on-chain via ecrecover).
async function issueCertificate(wallet, userId, certTypeId, student, consentSignature) {
  requireContracts();
  const authorized = await skillToken.authorizedIssuers(wallet.address);
  if (!authorized) throw new Error("carteira autenticada não é emissor autorizado: o admin precisa autorizar esta instituição");
  const tx = await certEmitter.connect(wallet.connect(provider)).issueCertificate(certTypeId, student, consentSignature);
  const receipt = await tx.wait();
  const tokenId = await certEmitter.studentTokenId(student, certTypeId);
  const burnAuth = Number(await certEmitter.burnAuth(tokenId));
  audit({ userId, address: wallet.address, kind: "issue-certificate", txHash: receipt.hash });
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, tokenId: tokenId.toString(), issuer: wallet.address, student, burnAuth };
}

// Revogação guiada pelo BurnAuth do token (o contrato valida quem pode queimar)
async function revokeCertificate(wallet, userId, tokenId) {
  requireContracts();
  const tx = await certEmitter.connect(wallet.connect(provider)).revokeCertificate(tokenId);
  const receipt = await tx.wait();
  audit({ userId, address: wallet.address, kind: "revoke-certificate", txHash: receipt.hash });
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, tokenId: tokenId.toString() };
}

// Resolve tokenId por (aluno, tipo) e revoga — valida BurnAuth no contrato
async function revokeCertificateResolved(wallet, userId, student, certTypeId) {
  requireContracts();
  const tokenId = await certEmitter.studentTokenId(student, Number(certTypeId));
  if (tokenId === 0n) throw new Error("aluno não possui esse certificado");
  const result = await revokeCertificate(wallet, userId, tokenId);
  return { ...result, student, certTypeId: Number(certTypeId) };
}

// ===== Operações de administração (assinas com chaves internas; JWT valida quem pede) =====
async function setSkillThreshold(threshold) {
  requireContracts();
  const tx = await skillToken.connect(deployer).setSkillThreshold(threshold);
  const receipt = await tx.wait();
  audit({ userId: null, address: deployer.address, kind: "set-skill-threshold", txHash: receipt.hash });
  return { threshold, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function setRequiredSigners(certTypeId, signers) {
  requireContracts();
  const tx = await certEmitter.connect(contractOwner).setRequiredSigners(Number(certTypeId), signers);
  const receipt = await tx.wait();
  audit({ userId: null, address: contractOwner.address, kind: "set-required-signers", txHash: receipt.hash });
  return { certTypeId: Number(certTypeId), signers, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function setSkillBadgeURI(skillType, uri) {
  requireContracts();
  const tx = await skillToken.connect(deployer).setSkillBadgeURI(skillType, uri);
  const receipt = await tx.wait();
  audit({ userId: null, address: deployer.address, kind: "set-skill-badge", txHash: receipt.hash });
  return { skillType, uri, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function setCertBadgeURI(certTypeId, uri) {
  requireContracts();
  const tx = await certEmitter.connect(contractOwner).setCertificateBadgeURI(Number(certTypeId), uri);
  const receipt = await tx.wait();
  audit({ userId: null, address: contractOwner.address, kind: "set-cert-badge", txHash: receipt.hash });
  return { certTypeId: Number(certTypeId), uri, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function deleteCertType(certTypeId) {
  requireContracts();
  const tx = await certEmitter.connect(contractOwner).deleteCertificateType(Number(certTypeId));
  const receipt = await tx.wait();
  audit({ userId: null, address: contractOwner.address, kind: "delete-cert-type", txHash: receipt.hash });
  return { certTypeId: Number(certTypeId), txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

// Signatários obrigatórios definidos para um tipo de certificado
async function requiredSigners(certTypeId) {
  requireContracts();
  const signers = await certEmitter.getRequiredSigners(Number(certTypeId));
  return { certTypeId: Number(certTypeId), signers };
}

// Quem ainda precisa atestar todas as skills exigidas de um tipo de certificado
async function missingSigners(student, certTypeId) {
  requireContracts();
  const requiredSigners = await certEmitter.getRequiredSigners(Number(certTypeId));
  const allSigned = await certEmitter.allSignersSigned(student, Number(certTypeId));
  const missing = await certEmitter.missingSigners(student, Number(certTypeId));
  const out = [];
  for (const addr of missing) {
    out.push({ address: addr, username: usernameFor(addr) });
  }
  const missingSkillHashes = await certEmitter.missingSkills(student, Number(certTypeId));
  const missingSkills = [];
  for (const h of missingSkillHashes) {
    missingSkills.push({ skillType: h, name: (await skillToken.skillNames(h)) || h });
  }
  return {
    student,
    certTypeId: Number(certTypeId),
    requiredSigners,
    allSigned,
    missing: out,
    missingSkills,
  };
}

// Consentimento do aluno (EIP-5484): assinatura EIP-191 sobre
// keccak256(abi.encodePacked("EduValidaConsent:", certTypeId, student, issuer))
async function buildConsentDigest(walletAddress, certTypeId, issuer) {
  const { solidityPacked, keccak256 } = ethers;
  return keccak256(
    solidityPacked(
      ["string", "uint256", "address", "address"],
      ["EduValidaConsent:", certTypeId, walletAddress, issuer]
    )
  );
}

// ===== Consultas =====
async function listSkills() {
  requireContracts();
  const types = await skillToken.getKnownSkillTypes();
  const out = [];
  for (const t of types) {
    let badgeUri = "";
    try { badgeUri = await skillToken.skillBadgeURI(t); } catch {}
    out.push({ skillType: t, name: await skillToken.skillNames(t), badgeUri });
  }
  return out;
}

async function listCertTypes() {
  requireContracts();
  const ids = await certEmitter.getCertTypeIds();
  const out = [];
  for (const bigId of ids) {
    const cert = await certEmitter.certificateTypes(Number(bigId));
    if (cert.exists) out.push({ id: Number(bigId), name: cert.name, burnAuth: Number(cert.burnAuth), burnAuthName: BURN_AUTH_NAMES[Number(cert.burnAuth)] });
  }
  return out;
}

// Lista de emissores autorizados on-chain, resolvidos via WalletRegistry
async function authorizedIssuersList() {
  requireContracts();
  const issuers = await skillToken.getIssuersList();
  const out = [];
  for (const addr of issuers) {
    const isAuth = await skillToken.authorizedIssuers(addr);
    if (!isAuth) continue;
    const ownerHash = await chainOwnerOf(addr);
    out.push({ address: addr, registered: !isZero32(ownerHash), username: usernameFor(addr) });
  }
  return out;
}

// Validação: quem atestou (on-chain) -> quem pertence (WalletRegistry + usuários locais)
async function attestationsOf(student, skillType) {
  requireContracts();
  const issuers = await skillToken.getIssuersList();
  const attestations = [];
  for (const issuer of issuers) {
    const has = await skillToken.hasSkillFrom(issuer, student, skillType);
    if (!has) continue;
    const ownerHash = await chainOwnerOf(issuer);
    attestations.push({
      issuer,
      registered: !isZero32(ownerHash),
      ownerIdHash: isZero32(ownerHash) ? null : ownerHash,
      username: usernameFor(issuer),
    });
  }
  const count = Number(await skillToken.skillAttestationCount(student, skillType));
  const threshold = Number(await skillToken.skillThreshold());
  return { student, skillType, count, threshold, attestations };
}

// Resolve identidade (WalletRegistry + usuários locais) de qualquer endereço
async function whoIs(address) {
  const ownerHash = await chainOwnerOf(address);
  const username = usernameFor(address);
  return { address: String(address).toLowerCase(), registered: !isZero32(ownerHash), ownerIdHash: isZero32(ownerHash) ? null : ownerHash, username };
}

module.exports = {
  requireContracts,
  createSkill,
  createCertType,
  setIssuerState,
  issueSkill,
  issueCertificate,
  revokeCertificate,
  revokeCertificateResolved,
  setSkillThreshold,
  setRequiredSigners,
  setSkillBadgeURI,
  setCertBadgeURI,
  deleteCertType,
  requiredSigners,
  missingSigners,
  buildConsentDigest,
  listSkills,
  listCertTypes,
  authorizedIssuersList,
  attestationsOf,
  whoIs,
  skillToken,
  certEmitter,
};
