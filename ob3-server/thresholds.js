const db = require("./db");
const { buildSkillCredential, buildCertCredential } = require("./issuer");
const { allocateIndex, setStatus, statusEntryFor } = require("./statuslist");
const crypto = require("node:crypto");

function getSkillThreshold() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'skill_threshold'").get();
  return parseInt(row?.value || "1", 10);
}

function setSkillThreshold(n) {
  db.prepare("INSERT INTO config (key, value) VALUES ('skill_threshold', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
}

function attestationCount(studentDid, skillId) {
  const row = db
    .prepare("SELECT COUNT(DISTINCT issuer_id) AS c FROM skill_assertions WHERE student_did = ? AND skill_id = ? AND revoked = 0")
    .get(studentDid, skillId);
  return row?.c || 0;
}

function hasSkill(studentDid, skillId) {
  return attestationCount(studentDid, skillId) >= getSkillThreshold();
}

function hasSkillFrom(issuerId, studentDid, skillId) {
  const row = db
    .prepare("SELECT 1 FROM skill_assertions WHERE student_did = ? AND skill_id = ? AND issuer_id = ? AND revoked = 0 LIMIT 1")
    .get(studentDid, skillId, issuerId);
  return !!row;
}

function listStudentSkills(studentDid) {
  return db
    .prepare(
      `SELECT s.id, s.name, s.achievement_url,
              (SELECT COUNT(DISTINCT sa.issuer_id) FROM skill_assertions sa
                WHERE sa.student_did = ? AND sa.skill_id = s.id AND sa.revoked = 0) AS attestation_count,
              (SELECT GROUP_CONCAT(DISTINCT sa2.issuer_id) FROM skill_assertions sa2
                WHERE sa2.student_did = ? AND sa2.skill_id = s.id AND sa2.revoked = 0) AS issuers
       FROM skills s ORDER BY s.id`
    )
    .all(studentDid, studentDid);
}

function allSignersSigned(studentDid, certType) {
  const requiredSkills = JSON.parse(certType.required_skills);
  const requiredSigners = JSON.parse(certType.required_signers);
  for (const signer of requiredSigners) {
    for (const skillId of requiredSkills) {
      if (!hasSkillFrom(signer, studentDid, skillId)) return false;
    }
  }
  return true;
}

function canClaim(studentDid, certTypeId) {
  const cert = db.prepare("SELECT * FROM cert_types WHERE id = ?").get(certTypeId);
  if (!cert) return { ok: false, reason: "cert_type not found" };
  const requiredSkills = JSON.parse(cert.required_skills);
  for (const skillId of requiredSkills) {
    if (!hasSkill(studentDid, skillId)) return { ok: false, reason: `skill ${skillId} não tem ${getSkillThreshold()}+ atestações` };
  }
  if (!allSignersSigned(studentDid, cert)) return { ok: false, reason: "nem todos os signatários obrigatórios emitiram todas as skills" };
  return { ok: true, cert };
}

function missingSkillsForSigner(studentDid, certType) {
  const requiredSkills = JSON.parse(certType.required_skills);
  const requiredSigners = JSON.parse(certType.required_signers);
  const missing = [];
  for (const signer of requiredSigners) {
    for (const skillId of requiredSkills) {
      if (!hasSkillFrom(signer, studentDid, skillId)) missing.push({ signer, skillId });
    }
  }
  return missing;
}

function issueSkill({ issuerId, studentDid, skillId }) {
  const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId);
  if (!skill) throw new Error("skill not found");
  const existing = db
    .prepare("SELECT * FROM skill_assertions WHERE student_did = ? AND skill_id = ? AND issuer_id = ?")
    .get(studentDid, skillId, issuerId);
  if (existing) return { jti: null, token: existing.credential_jwt, status_index: existing.status_index, duplicate: true };
  const statusIndex = allocateIndex();
  const statusEntry = statusEntryFor(statusIndex);
  const { jti, token } = buildSkillCredential({
    issuerId,
    issuerUrl: `${process.env.OB3_BASE_URL || "http://localhost:3001"}/issuers/${issuerId}`,
    studentDid,
    skillId,
    skillName: skill.name,
    achievementUrl: skill.achievement_url,
    statusIndex,
    statusEntry,
  });
  const insert = db.prepare(
    "INSERT INTO skill_assertions (student_did, skill_id, issuer_id, credential_jwt, status_index) VALUES (?, ?, ?, ?, ?)"
  );
  const info = insert.run(studentDid, skillId, issuerId, token, statusIndex);
  return { id: info.lastInsertRowid, jti, token, status_index: statusIndex, duplicate: false };
}

function revokeSkill({ studentDid, skillId, issuerId }) {
  const row = db
    .prepare("SELECT * FROM skill_assertions WHERE student_did = ? AND skill_id = ? AND issuer_id = ?")
    .get(studentDid, skillId, issuerId);
  if (!row) throw new Error("assertion not found");
  db.prepare("UPDATE skill_assertions SET revoked = 1 WHERE id = ?").run(row.id);
  setStatus(row.status_index, true);
  return { ok: true };
}

function claimCertificate({ studentDid, certTypeId, issuerId }) {
  const check = canClaim(studentDid, certTypeId);
  if (!check.ok) throw new Error(check.reason);
  const cert = check.cert;
  const existing = db
    .prepare("SELECT * FROM cert_assertions WHERE student_did = ? AND cert_type_id = ?")
    .get(studentDid, certTypeId);
  if (existing) return { jti: null, token: existing.credential_jwt, status_index: existing.status_index, duplicate: true };
  const requiredSkills = JSON.parse(cert.required_skills);
  const jtis = db
    .prepare(
      `SELECT credential_jwt FROM skill_assertions
       WHERE student_did = ? AND skill_id IN (${requiredSkills.map(() => "?").join(",")}) AND revoked = 0`
    )
    .all(studentDid, ...requiredSkills)
    .map((r) => jwtDecodeJti(r.credential_jwt));
  const statusIndex = allocateIndex();
  const statusEntry = statusEntryFor(statusIndex);
  const { jti, token } = buildCertCredential({
    issuerId,
    issuerUrl: `${process.env.OB3_BASE_URL || "http://localhost:3001"}/issuers/${issuerId}`,
    studentDid,
    certTypeId,
    certName: cert.name,
    requiredSkillJtis: jtis,
    statusEntry,
  });
  const insert = db.prepare("INSERT INTO cert_assertions (student_did, cert_type_id, credential_jwt, status_index) VALUES (?, ?, ?, ?)");
  const info = insert.run(studentDid, certTypeId, token, statusIndex);
  return { id: info.lastInsertRowid, jti, token, status_index: statusIndex, duplicate: false };
}

function jwtDecodeJti(jwtToken) {
  const decoded = JSON.parse(Buffer.from(jwtToken.split(".")[1], "base64url").toString("utf8"));
  return decoded.jti;
}

function revokeCertificate({ studentDid, certTypeId }) {
  const row = db
    .prepare("SELECT * FROM cert_assertions WHERE student_did = ? AND cert_type_id = ?")
    .get(studentDid, certTypeId);
  if (!row) throw new Error("certificate not found");
  db.prepare("UPDATE cert_assertions SET revoked = 1 WHERE id = ?").run(row.id);
  setStatus(row.status_index, true);
  return { ok: true };
}

module.exports = {
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
};
