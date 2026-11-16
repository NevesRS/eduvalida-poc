const db = require("./db");
const zlib = require("node:zlib");
const { buildCertCredential, signIssuerJWT, BASE_URL } = require("./issuer");

const STATUS_PURPOSE = "revocation";
const LIST_SIZE = 1024;

function ensureStatusList() {
  const row = db.prepare("SELECT bitstring FROM status_list WHERE id = 1").get();
  if (!row) {
    db.prepare("INSERT INTO status_list (id, bitstring) VALUES (1, ?)").run(Buffer.alloc(LIST_SIZE / 8, 0));
    return Buffer.alloc(LIST_SIZE / 8, 0);
  }
  return row.bitstring;
}

function allocateIndex() {
  const buf = ensureStatusList();
  const asserted = db
    .prepare("SELECT status_index FROM skill_assertions WHERE status_index IS NOT NULL UNION SELECT status_index FROM cert_assertions WHERE status_index IS NOT NULL")
    .all();
  const used = new Set(asserted.map((r) => r.status_index));
  for (let i = 0; i < LIST_SIZE; i++) {
    if (!used.has(i)) return i;
  }
  throw new Error("Status list cheia");
}

function setStatus(index, revoked) {
  const buf = Buffer.from(ensureStatusList());
  const byteIndex = Math.floor(index / 8);
  const bit = index % 8;
  if (revoked) buf[byteIndex] |= (1 << bit) & 0xff;
  else buf[byteIndex] &= ~(1 << bit) & 0xff;
  db.prepare("UPDATE status_list SET bitstring = ?, updated_at = datetime('now') WHERE id = 1").run(buf);
}

function isRevoked(index) {
  const buf = ensureStatusList();
  const byteIndex = Math.floor(index / 8);
  const bit = index % 8;
  return (buf[byteIndex] & ((1 << bit) & 0xff)) !== 0;
}

function buildStatusListCredential() {
  const buf = ensureStatusList();
  const gz = zlib.gzipSync(buf);
  const encoded = gz.toString("base64url");
  const statusListUrl = `${BASE_URL}/status-list/1`;
  const payload = {
    iss: `${BASE_URL}/issuers/admin`,
    jti: statusListUrl,
    nbf: Math.floor(Date.now() / 1000),
    vc: {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      id: statusListUrl,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      credentialSubject: {
        id: `${statusListUrl}#list`,
        statusList: {
          id: statusListUrl,
          encodedList: `gz:${encoded}`,
        },
        statusPurpose: STATUS_PURPOSE,
      },
    },
  };
  const token = signIssuerJWT("admin", payload);
  return { token, encodedList: `gz:${encoded}`, statusPurpose: STATUS_PURPOSE, statusListUrl };
}

function statusEntryFor(index) {
  return {
    type: "BitstringStatusListEntry",
    statusPurpose: STATUS_PURPOSE,
    statusListIndex: String(index),
    statusListCredential: `${BASE_URL}/status-list/1`,
  };
}

module.exports = {
  LIST_SIZE,
  allocateIndex,
  setStatus,
  isRevoked,
  buildStatusListCredential,
  statusEntryFor,
};
