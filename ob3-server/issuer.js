const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const db = require("./db");
const { getIssuerKeypair } = require("./keys");

const BASE_URL = process.env.OB3_BASE_URL || "http://localhost:3001";

const OB3_CONTEXT = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
];

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function nextCredentialUrl() {
  const jti = crypto.randomUUID();
  return `${BASE_URL}/credentials/${jti}`;
}

function signIssuerJWT(issuerId, payload) {
  const kp = getIssuerKeypair(issuerId);
  return jwt.sign(payload, kp.privateKey, {
    algorithm: "RS256",
    keyid: kp.jwk.kid,
    noTimestamp: true,
  });
}

function buildSkillCredential({ issuerId, issuerUrl, studentDid, skillId, skillName, achievementUrl, statusIndex, statusEntry }) {
  const jti = nextCredentialUrl();
  const payload = {
    iss: issuerUrl,
    sub: studentDid,
    jti,
    nbf: nowEpoch(),
    vc: {
      "@context": OB3_CONTEXT,
      id: jti,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      issuer: { id: issuerUrl, type: ["Profile"], name: issuerId },
      credentialSubject: {
        id: studentDid,
        achievement: {
          id: achievementUrl,
          name: skillName,
          achievementType: "Competency",
          description: `Competência: ${skillName}`,
          criteria: {
            narrative: `Emitida por ${issuerId} após avaliação própria.`,
          },
        },
      },
    },
  };
  if (statusEntry) payload.vc.credentialStatus = statusEntry;
  const token = signIssuerJWT(issuerId, payload);
  return { jti, token };
}

function buildCertCredential({ issuerId, issuerUrl, studentDid, certTypeId, certName, requiredSkillJtis, statusEntry }) {
  const jti = nextCredentialUrl();
  const payload = {
    iss: issuerUrl,
    sub: studentDid,
    jti,
    nbf: nowEpoch(),
    vc: {
      "@context": OB3_CONTEXT,
      id: jti,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      issuer: { id: issuerUrl, type: ["Profile"], name: issuerId },
      credentialSubject: {
        id: studentDid,
        achievement: {
          id: `${BASE_URL}/achievements/cert/${certTypeId}`,
          name: certName,
          achievementType: "Certificate",
          description: `Certificado: ${certName}`,
          criteria: {
            narrative: "Todas as skills exigidas foram emitidas por todos os signatários obrigatórios.",
          },
        },
      },
      evidence: requiredSkillJtis.map((j) => ({ id: j })),
    },
  };
  if (statusEntry) payload.vc.credentialStatus = statusEntry;
  const token = signIssuerJWT(issuerId, payload);
  return { jti, token };
}

function verifyCredentialJWT(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error("JWT inválido");
  const issuerId = decoded.payload.iss;
  const row = db.prepare("SELECT id, issuer_url FROM institutions WHERE issuer_url = ?").get(issuerId);
  if (!row) throw new Error("issuer não registrado: " + issuerId);
  const kp = getIssuerKeypair(row.id);
  const verified = jwt.verify(token, kp.publicKey, { algorithms: ["RS256"] });
  return verified;
}

function getAchievement(skillId) {
  const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId);
  if (!skill) return null;
  return {
    id: skill.achievement_url,
    name: skill.name,
    achievementType: "Competency",
    description: `Competência: ${skill.name}`,
    criteria: {
      narrative: "Emitida por instituição autorizada.",
    },
    "@context": OB3_CONTEXT,
  };
}

function getCertAchievement(certTypeId) {
  const cert = db.prepare("SELECT * FROM cert_types WHERE id = ?").get(certTypeId);
  if (!cert) return null;
  return {
    id: `${BASE_URL}/achievements/cert/${certTypeId}`,
    name: cert.name,
    achievementType: "Certificate",
    description: `Certificado: ${cert.name}`,
    criteria: {
      narrative: "Todas as skills exigidas emitidas por todos os signatários obrigatórios.",
    },
    "@context": OB3_CONTEXT,
  };
}

module.exports = {
  BASE_URL,
  buildSkillCredential,
  buildCertCredential,
  verifyCredentialJWT,
  getAchievement,
  getCertAchievement,
  nextCredentialUrl,
  signIssuerJWT,
};
