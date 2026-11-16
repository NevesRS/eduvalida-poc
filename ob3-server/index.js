const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const bs58 = require("bs58");
const { ed25519 } = require("@noble/curves/ed25519.js");

const db = require("./db");
const { getIssuerKeypair, didKeyFromRaw, rawEd25519Pub } = require("./keys");
const { BASE_URL, buildSkillCredential, buildCertCredential, verifyCredentialJWT, getAchievement, getCertAchievement } = require("./issuer");
const {
  getSkillThreshold,
  setSkillThreshold,
  attestationCount,
  hasSkill,
  hasSkillFrom,
  listStudentSkills,
  allSignersSigned,
  canClaim,
  missingSkillsForSigner,
  issueSkill,
  revokeSkill,
  claimCertificate,
  revokeCertificate,
} = require("./thresholds");
const { allocateIndex, setStatus, isRevoked, buildStatusListCredential, statusEntryFor } = require("./statuslist");

const app = express();
app.use(express.json());

// CORS simples para dev Vite
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Issuer");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function currentIssuerId(req) {
  const issuer = req.header("X-Issuer") || "institution1";
  return issuer;
}

function requireIssuer(req, res, next) {
  const id = currentIssuerId(req);
  const row = db.prepare("SELECT * FROM institutions WHERE id = ?").get(id);
  if (!row) return res.status(403).json({ error: `issuer não registrado: ${id}` });
  req.issuerRow = row;
  next();
}

// ===== JWKS =====
app.get("/.well-known/jwks.json", (req, res) => {
  const keys = db.prepare("SELECT id FROM institutions").all();
  const jwks = keys.map((k) => getIssuerKeypair(k.id).jwk);
  res.json({ keys: jwks });
});

// ===== Achievement metadata =====
app.get("/achievements/:skillId", (req, res) => {
  const a = getAchievement(Number(req.params.skillId));
  if (!a) return res.status(404).json({ error: "not found" });
  res.json(a);
});

app.get("/achievements/cert/:certTypeId", (req, res) => {
  const a = getCertAchievement(Number(req.params.certTypeId));
  if (!a) return res.status(404).json({ error: "not found" });
  res.json(a);
});

// ===== Status list =====
app.get("/status-list/1", (req, res) => {
  const { token } = buildStatusListCredential();
  res.setHeader("Content-Type", "application/jwt");
  res.send(token);
});

// ===== Skills (catálogo) =====
app.get("/api/skills", (req, res) => {
  const rows = db.prepare("SELECT * FROM skills ORDER BY id").all();
  res.json(rows);
});

app.post("/api/skills", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const achievementUrl = `${BASE_URL}/achievements/new-${Date.now()}`;
  try {
    const info = db.prepare("INSERT INTO skills (name, achievement_url) VALUES (?, ?)").run(name, achievementUrl);
    const skillId = info.lastInsertRowid;
    db.prepare("UPDATE skills SET achievement_url = ? WHERE id = ?").run(`${BASE_URL}/achievements/${skillId}`, skillId);
    res.status(201).json({ id: skillId, name, achievement_url: `${BASE_URL}/achievements/${skillId}` });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "skill já existe" });
    throw e;
  }
});

// ===== Cert types =====
app.get("/api/cert-types", (req, res) => {
  const rows = db.prepare("SELECT * FROM cert_types ORDER BY id").all();
  res.json(rows.map((r) => ({ ...r, required_skills: JSON.parse(r.required_skills), required_signers: JSON.parse(r.required_signers) })));
});

app.post("/api/cert-types", (req, res) => {
  const { name, required_skills } = req.body;
  if (!name || !Array.isArray(required_skills) || required_skills.length === 0)
    return res.status(400).json({ error: "name e required_skills[] obrigatórios" });
  const info = db.prepare("INSERT INTO cert_types (name, required_skills, required_signers) VALUES (?, ?, '[]')").run(name, JSON.stringify(required_skills.map(Number)));
  res.status(201).json({ id: info.lastInsertRowid, name, required_skills });
});

app.post("/api/cert-types/:id/signers", requireIssuer, (req, res) => {
  const { required_signers } = req.body;
  if (!Array.isArray(required_signers)) return res.status(400).json({ error: "required_signers[] obrigatório" });
  const cert = db.prepare("SELECT * FROM cert_types WHERE id = ?").get(Number(req.params.id));
  if (!cert) return res.status(404).json({ error: "cert type not found" });
  db.prepare("UPDATE cert_types SET required_signers = ? WHERE id = ?").run(JSON.stringify(required_signers), cert.id);
  res.json({ ok: true, required_signers });
});

app.get("/api/cert-types/:id/check", (req, res) => {
  const cert = db.prepare("SELECT * FROM cert_types WHERE id = ?").get(Number(req.params.id));
  if (!cert) return res.status(404).json({ error: "not found" });
  const studentDid = req.query.student;
  if (!studentDid) return res.status(400).json({ error: "student query param required" });
  const check = canClaim(studentDid, cert.id);
  const missing = missingSkillsForSigner(studentDid, cert);
  res.json({ ...check, missing_for_signers: missing });
});

// ===== Skills: emitir / revogar / consultar =====
app.post("/api/skills/:id/issue", requireIssuer, (req, res) => {
  const { studentDid } = req.body;
  if (!studentDid) return res.status(400).json({ error: "studentDid required" });
  try {
    const result = issueSkill({ issuerId: req.issuerRow.id, studentDid, skillId: Number(req.params.id) });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/skills/:id/revoke", requireIssuer, (req, res) => {
  const { studentDid } = req.body;
  if (!studentDid) return res.status(400).json({ error: "studentDid required" });
  try {
    revokeSkill({ studentDid, skillId: Number(req.params.id), issuerId: req.issuerRow.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/students/:did/skills", (req, res) => {
  const threshold = getSkillThreshold();
  const rows = listStudentSkills(req.params.did);
  res.json({
    threshold,
    skills: rows.map((r) => ({
      id: r.id,
      name: r.name,
      achievement_url: r.achievement_url,
      attestation_count: r.attestation_count,
      issuers: r.issuers ? r.issuers.split(",") : [],
      has_skill: r.attestation_count >= threshold,
    })),
  });
});

app.get("/api/skills/:id/attestations", (req, res) => {
  const studentDid = req.query.student;
  if (!studentDid) return res.status(400).json({ error: "student query param required" });
  const count = attestationCount(studentDid, Number(req.params.id));
  const threshold = getSkillThreshold();
  res.json({ attestation_count: count, threshold, has_skill: count >= threshold });
});

// ===== Config: threshold =====
app.get("/api/config", (req, res) => {
  res.json({ skill_threshold: getSkillThreshold() });
});

app.post("/api/config/threshold", (req, res) => {
  const { threshold } = req.body;
  const n = Number(threshold);
  if (!n || n < 1) return res.status(400).json({ error: "threshold >= 1 required" });
  setSkillThreshold(n);
  res.json({ skill_threshold: getSkillThreshold() });
});

// ===== Claim certificado =====
app.post("/api/cert-types/:id/claim", requireIssuer, (req, res) => {
  const { studentDid } = req.body;
  if (!studentDid) return res.status(400).json({ error: "studentDid required" });
  try {
    const result = claimCertificate({ studentDid, certTypeId: Number(req.params.id), issuerId: req.issuerRow.id });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/cert-types/:id/revoke", requireIssuer, (req, res) => {
  const { studentDid } = req.body;
  if (!studentDid) return res.status(400).json({ error: "studentDid required" });
  try {
    revokeCertificate({ studentDid, certTypeId: Number(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/students/:did/certificates", (req, res) => {
  const rows = db.prepare("SELECT * FROM cert_assertions WHERE student_did = ? ORDER BY id").all(req.params.did);
  res.json(
    rows.map((r) => ({
      id: r.id,
      cert_type_id: r.cert_type_id,
      status_index: r.status_index,
      revoked: !!r.revoked || isRevoked(r.status_index),
      issued_at: r.issued_at,
      jti: JSON.parse(Buffer.from(r.credential_jwt.split(".")[1], "base64url").toString("utf8")).jti,
    }))
  );
});

// ===== Credential store =====
app.get("/credentials/:jti", (req, res) => {
  const wantedJti = `${BASE_URL}/credentials/${req.params.jti}`;
  const findJti = (rows) => {
    for (const r of rows) {
      const decoded = JSON.parse(Buffer.from(r.credential_jwt.split(".")[1], "base64url").toString("utf8"));
      if (decoded.jti === wantedJti) return r.credential_jwt;
    }
    return null;
  };
  const skillJwt = findJti(db.prepare("SELECT credential_jwt FROM skill_assertions").all());
  const certJwt = findJti(db.prepare("SELECT credential_jwt FROM cert_assertions").all());
  const jwtToken = skillJwt || certJwt;
  if (!jwtToken) return res.status(404).json({ error: "not found" });
  const decoded = JSON.parse(Buffer.from(jwtToken.split(".")[1], "base64url").toString("utf8"));
  res.json(decoded);
});

// ===== Verificar credencial (verificação completa: assinatura + status) =====
app.post("/api/verify", (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "credential JWT required" });
  try {
    const payload = verifyCredentialJWT(credential);
    const statusIndex = payload?.vc?.credentialSubject?.achievement?.id ? null : null;
    // Se tiver credentialStatus embutido, checar bit
    let revoked = false;
    if (payload.vc?.credentialStatus) {
      revoked = isRevoked(Number(payload.vc.credentialStatus.statusListIndex));
    }
    res.json({ verified: true, revoked, payload });
  } catch (e) {
    res.json({ verified: false, error: e.message });
  }
});

// ===== Instituições (seed/debug) =====
app.get("/api/institutions", (req, res) => {
  const rows = db.prepare("SELECT * FROM institutions ORDER BY id").all();
  res.json(rows);
});

app.post("/api/institutions", (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: "id e name required" });
  const issuerUrl = `${BASE_URL}/issuers/${id}`;
  db.prepare("INSERT OR REPLACE INTO institutions (id, name, issuer_url) VALUES (?, ?, ?)").run(id, name, issuerUrl);
  getIssuerKeypair(id); // gera chave se não existir
  res.status(201).json({ id, name, issuer_url: issuerUrl });
});

const PORT = process.env.OB3_PORT || 3001;
app.listen(PORT, () => {
  console.log(`[ob3-server] ouvindo em ${BASE_URL} (porta ${PORT})`);
});

module.exports = app;
