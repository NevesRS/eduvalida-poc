const express = require("express");
const crypto = require("node:crypto");
const { Wallet, getBytes } = require("ethers");

const db = require("./db");
const { createEvmWallet, walletFromRow } = require("./keystore");
const { hashPassword, verifyPassword, issueToken, requireAuth, requireRole } = require("./auth");
const { provider, requireChain, registry, ownerIdHashFrom, buildRegistrationMessage, chainOwnerOf, chainInfo, REGISTRY_ABI } = require("./chain");
const { signMessage } = require("./signature");
const eduflow = require("./eduflow");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function audit({ userId, address, kind, payloadHash, signature, recovered, txHash, valid }) {
  db.prepare(
    "INSERT INTO signatures (user_id, address, kind, payload_hash, signature, recovered_address, tx_hash, valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, address, kind, payloadHash || null, signature || null, recovered || null, txHash || null, valid ? 1 : 0);
}

function getWalletByUser(userId) {
  return db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId);
}

function walletPublic(row) {
  return { address: row.address, publicKey: row.public_key, createdAt: row.created_at };
}

async function registerOnChain(wallet, username) {
  const reg = registry();
  const ownerIdHash = ownerIdHashFrom(username);
  const messageBytes = buildRegistrationMessage(ownerIdHash, wallet.address);
  const { digest, signature } = await signMessage(wallet, messageBytes);
  const regWithWallet = reg.connect(wallet);
  const tx = await regWithWallet.register(ownerIdHash, signature);
  const receipt = await tx.wait();
  return { ownerIdHash, digest, signature, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

// ===== Auth =====
app.post("/auth/register", requireChain, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username e password obrigatórios" });
  if (role && !["student", "institution"].includes(role)) {
    return res.status(400).json({ error: "role deve ser 'student' ou 'institution'" });
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return res.status(409).json({ error: "usuário já existe" });
  }
  try {
    // 1) gera carteira; 2) registra na blockchain (obrigatório); 3) só então persiste
    const walletData = createEvmWallet();
    const onChain = await registerOnChain(new Wallet(walletData.privateKey, provider), username);

    const userId = crypto.randomUUID();
    const userRole = role || "student";
    const { salt, hash } = hashPassword(password);
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)").run(userId, username, hash, salt, userRole);
      db.prepare("INSERT INTO wallets (id, user_id, address, public_key, enc_priv, iv, tag) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        walletData.id, userId, walletData.address, walletData.publicKey, walletData.enc_priv, walletData.iv, walletData.tag
      );
    });
    tx();

    audit({ userId, address: walletData.address, kind: "registry", payloadHash: onChain.digest, signature: onChain.signature, txHash: onChain.txHash, valid: true });
    res.status(201).json({
      token: issueToken(userId, username, userRole),
      user: { id: userId, username, role: userRole },
      wallet: { address: walletData.address, publicKey: walletData.publicKey },
      registration: { ownerIdHash: onChain.ownerIdHash, txHash: onChain.txHash, blockNumber: onChain.blockNumber },
    });
  } catch (e) {
    res.status(502).json({ error: "falha ao registrar na blockchain: " + e.message });
  }
});

app.post("/auth/login", requireChain, (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  if (!user || !verifyPassword(password || "", user)) {
    return res.status(401).json({ error: "credenciais inválidas" });
  }
  const wallet = getWalletByUser(user.id);
  res.json({
    token: issueToken(user.id, user.username, user.role),
    user: { id: user.id, username: user.username, role: user.role },
    wallet: wallet ? walletPublic(wallet) : null,
  });
});

app.get("/me", requireAuth, async (req, res) => {
  const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(req.auth.sub);
  if (!user) return res.status(404).json({ error: "usuário não encontrado" });
  const wallet = getWalletByUser(user.id);
  const ownerHash = wallet ? await chainOwnerOf(wallet.address) : null;
  const isIssuer = wallet ? await eduflow.skillToken.authorizedIssuers(wallet.address) : false;
  res.json({ user, wallet: wallet ? walletPublic(wallet) : null, onChainOwner: ownerHash, isIssuer: !!isIssuer });
});

// ===== Consulta on-chain: quem pertence a uma carteira =====
app.get("/chain/registry/:address", requireChain, async (req, res) => {
  if (!assertRegistry(res)) return;
  const address = req.params.address.toLowerCase();
  const ownerHash = await chainOwnerOf(address);
  const registered = ownerHash && ownerHash !== "0x" + "0".repeat(64);
  const dbUser = registered ? db.prepare("SELECT username FROM users u JOIN wallets w ON w.user_id = u.id WHERE LOWER(w.address) = ?").get(address) : null;
  res.json({ address, registered: !!registered, ownerIdHash: ownerHash, username: dbUser ? dbUser.username : null });
});

app.get("/chain/health", async (req, res) => {
  try {
    let threshold = null;
    try { threshold = Number(await eduflow.skillToken.skillThreshold()); } catch {}
    const cfg = require("./config");
    res.json({
      ...(await chainInfo()),
      ready: !!registry(),
      threshold,
      contracts: { skillToken: cfg.SKILL_TOKEN_ADDRESS, certificateEmitter: cfg.CERT_EMITTER_ADDRESS, walletRegistry: cfg.REGISTRY_ADDRESS },
    });
  } catch {
    res.status(503).json({ rpc: false, error: "Besu offline em " + require("./config").RPC_URL });
  }
});

// ===== Fluxo real: SkillToken + CertificateEmitter com carteiras autenticadas (1:1) =====
// Catálogo (skills, tipos de cert) é administrado pela PLATAFORMA — só o admin.
app.post("/chain/create-skill", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name obrigatório" });
  try { res.status(201).json(await eduflow.createSkill(name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/chain/create-cert-type", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { name, skills, burnAuth } = req.body || {};
  if (!name || !Array.isArray(skills) || skills.length === 0) return res.status(400).json({ error: "name e skills[] obrigatórios" });
  const burn = Number(burnAuth ?? 0);
  if (!Number.isInteger(burn) || burn < 0 || burn > 3) return res.status(400).json({ error: "burnAuth deve ser 0=IssuerOnly, 1=OwnerOnly, 2=Both ou 3=Neither" });
  try { res.status(201).json(await eduflow.createCertType(name, skills, burn)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== Admin da plataforma: autorização de emissores + administração do catálogo =====
app.get("/admin/institutions", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  try {
    const rows = db.prepare("SELECT u.id, u.username, u.created_at, w.address FROM users u LEFT JOIN wallets w ON w.user_id = u.id WHERE u.role = 'institution'").all();
    const out = [];
    for (const row of rows) {
      const authorized = row.address ? await eduflow.skillToken.authorizedIssuers(row.address) : false;
      out.push({ userId: row.id, username: row.username, address: row.address || null, authorized: !!authorized, createdAt: row.created_at });
    }
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/institutions/:userId/authorize", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const row = db.prepare("SELECT w.address FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ? AND u.role = 'institution'").get(req.params.userId);
  if (!row) return res.status(404).json({ error: "instituição não encontrada" });
  try { res.json(await eduflow.setIssuerState(row.address, true, req.auth.sub)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/institutions/:userId/revoke", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const row = db.prepare("SELECT w.address FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ? AND u.role = 'institution'").get(req.params.userId);
  if (!row) return res.status(404).json({ error: "instituição não encontrada" });
  try { res.json(await eduflow.setIssuerState(row.address, false, req.auth.sub)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/skill-threshold", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { threshold } = req.body || {};
  const t = Number(threshold);
  if (!Number.isInteger(t) || t < 1) return res.status(400).json({ error: "threshold deve ser inteiro >= 1" });
  try { res.json(await eduflow.setSkillThreshold(t)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/cert-type/:id/required-signers", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { signers } = req.body || {};
  if (!Array.isArray(signers)) return res.status(400).json({ error: "signers[] obrigatório (pode ser vazio)" });
  try { res.json(await eduflow.setRequiredSigners(Number(req.params.id), signers)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/skill-badge", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { skillType, uri } = req.body || {};
  if (!skillType || !uri) return res.status(400).json({ error: "skillType e uri obrigatórios" });
  try { res.json(await eduflow.setSkillBadgeURI(skillType, uri)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/cert-badge", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  const { certTypeId, uri } = req.body || {};
  if (!certTypeId || !uri) return res.status(400).json({ error: "certTypeId e uri obrigatórios" });
  try { res.json(await eduflow.setCertBadgeURI(Number(certTypeId), uri)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/admin/cert-type/:id/delete", requireAuth, requireRole("admin"), requireChain, async (req, res) => {
  try { res.json(await eduflow.deleteCertType(Number(req.params.id))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/chain/authorized-issuers", requireChain, async (req, res) => {
  try { res.json(await eduflow.authorizedIssuersList()); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/chain/issue-skill", requireAuth, requireRole("institution"), requireChain, async (req, res) => {
  const { student, skillType } = req.body || {};
  if (!student || !skillType) return res.status(400).json({ error: "student e skillType obrigatórios" });
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try { res.status(201).json(await eduflow.issueSkill(walletFromRow(row), req.auth.sub, student, skillType)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== EIP-5484: consentimento do aluno + emissão consensual pela instituição =====
app.post("/sign/consent", requireAuth, requireRole("student"), requireChain, async (req, res) => {
  const { certTypeId, issuer } = req.body || {};
  if (!certTypeId || !issuer) return res.status(400).json({ error: "certTypeId e issuer obrigatórios" });
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try {
    const wallet = walletFromRow(row);
    const digest = await eduflow.buildConsentDigest(wallet.address, Number(certTypeId), issuer);
    // Assina direto o digest do packed (EIP-191) — igual ao _validateConsent do contrato.
    // Não usar o helper signMessage aqui: ele hash-eia de novo (double hash).
    const signature = await wallet.signMessage(getBytes(digest));
    audit({ userId: req.auth.sub, address: row.address, kind: "consent-signature", payloadHash: digest, signature, valid: true });
    res.json({ digest, signature, certTypeId: Number(certTypeId), issuer, student: wallet.address });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/chain/issue-cert", requireAuth, requireRole("institution"), requireChain, async (req, res) => {
  const { certTypeId, student, consentSignature } = req.body || {};
  if (!certTypeId || !student || !consentSignature) {
    return res.status(400).json({ error: "certTypeId, student e consentSignature obrigatórios" });
  }
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try { res.status(201).json(await eduflow.issueCertificate(walletFromRow(row), req.auth.sub, Number(certTypeId), student, consentSignature)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Revogação: {student, certTypeId} (resolve tokenId no servidor) ou {tokenId}.
// Qualquer autenticado com carteira pode tentar; o contrato valida o BurnAuth de quem assina.
app.post("/chain/revoke-cert", requireAuth, requireChain, async (req, res) => {
  const { tokenId, student, certTypeId } = req.body || {};
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try {
    if (student && certTypeId) {
      res.json(await eduflow.revokeCertificateResolved(walletFromRow(row), req.auth.sub, student, certTypeId));
    } else if (tokenId) {
      res.json(await eduflow.revokeCertificate(walletFromRow(row), req.auth.sub, Number(tokenId)));
    } else {
      return res.status(400).json({ error: "informe student+certTypeId ou tokenId" });
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Read: signatários obrigatórios definidos para um tipo de certificado
app.get("/chain/cert-signers/:certTypeId", requireChain, async (req, res) => {
  try { res.json(await eduflow.requiredSigners(Number(req.params.certTypeId))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Read: quem ainda falta assinar/atestar para o aluno completar um certificado
app.get("/chain/missing-signers/:student/:certTypeId", requireChain, async (req, res) => {
  try { res.json(await eduflow.missingSigners(req.params.student, Number(req.params.certTypeId))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== Consultas pessoais do aluno autenticado =====
app.get("/me/skills", requireAuth, requireChain, async (req, res) => {
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try {
    const skills = await eduflow.listSkills();
    const out = [];
    for (const s of skills) {
      const has = await eduflow.skillToken.hasSkill(row.address, s.skillType);
      const count = Number(await eduflow.skillToken.skillAttestationCount(row.address, s.skillType));
      out.push({ ...s, has, attestations: count });
    }
    const threshold = Number(await eduflow.skillToken.skillThreshold());
    res.json({ address: row.address, threshold, skills: out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/me/certificates", requireAuth, requireChain, async (req, res) => {
  const row = getWalletByUser(req.auth.sub);
  if (!row) return res.status(404).json({ error: "carteira não encontrada" });
  try {
    const certTypes = await eduflow.listCertTypes();
    const out = [];
    for (const ct of certTypes) {
      const claimed = await eduflow.certEmitter.hasClaimed(row.address, ct.id);
      if (!claimed) continue;
      const tokenId = await eduflow.certEmitter.studentTokenId(row.address, ct.id);
      const issuer = await eduflow.certEmitter.tokenIssuer(tokenId);
      let badgeUri = "";
      try { badgeUri = await eduflow.certEmitter.certificateBadgeURI(ct.id); } catch {}
      out.push({ certTypeId: ct.id, name: ct.name, burnAuth: ct.burnAuth, burnAuthName: ct.burnAuthName, tokenId: tokenId.toString(), issuer, badgeUri });
    }
    res.json({ address: row.address, certificates: out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/chain/skills", requireChain, async (req, res) => {
  try { res.json(await eduflow.listSkills()); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.get("/chain/cert-types", requireChain, async (req, res) => {
  try { res.json(await eduflow.listCertTypes()); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.get("/chain/attestations/:student/:skillType", requireChain, async (req, res) => {
  try { res.json(await eduflow.attestationsOf(req.params.student, req.params.skillType)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/chain/who/:address", requireChain, async (req, res) => {
  try { res.json(await eduflow.whoIs(req.params.address)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

const PORT = require("./config").PORT;
app.listen(PORT, () => console.log(`[wallet-server] ouvindo em http://localhost:${PORT} (Besu: http://localhost:8545, registry: ${require("./config").REGISTRY_ADDRESS || "NÃO DEPLOYADO"})`));

module.exports = app;
