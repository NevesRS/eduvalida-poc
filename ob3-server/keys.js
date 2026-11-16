const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bs58 = require("bs58");

const KEYS_DIR = path.join(__dirname, "data", "keys");

function ensureDir() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

function loadOrCreateRSA(name) {
  const privPath = path.join(KEYS_DIR, `${name}.priv.pem`);
  const pubPath = path.join(KEYS_DIR, `${name}.pub.pem`);
  if (fs.existsSync(privPath)) {
    return {
      privateKey: crypto.createPrivateKey(fs.readFileSync(privPath)),
      publicKey: crypto.createPublicKey(fs.readFileSync(pubPath)),
    };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey, publicKey };
}

function loadOrCreateEd25519(name) {
  const privPath = path.join(KEYS_DIR, `${name}.ed25519.key`);
  const pubPath = path.join(KEYS_DIR, `${name}.ed25519.pub`);
  if (fs.existsSync(privPath)) {
    return {
      privateKey: crypto.createPrivateKey({ key: fs.readFileSync(privPath), format: "der", type: "pkcs8" }),
      publicKey: crypto.createPublicKey({ key: fs.readFileSync(pubPath), format: "der", type: "spki" }),
    };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "der" }));
  fs.writeFileSync(pubPath, publicKey.export({ type: "spki", format: "der" }));
  return { privateKey, publicKey };
}

function rawEd25519Pub(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32));
}

function didKeyFromRaw(rawBytes) {
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(rawBytes)]);
  return "did:key:z" + bs58.default.encode(multicodec);
}

function didKeyFromPublicKey(publicKey) {
  return didKeyFromRaw(rawEd25519Pub(publicKey));
}

const ISSUER_IDS = {
  institution1: "institution1",
  institution2: "institution2",
  admin: "admin",
};

function getIssuerKeypair(name) {
  ensureDir();
  const { privateKey, publicKey } = loadOrCreateRSA(name);
  const jwk = publicKey.export({ format: "jwk" });
  return {
    id: name,
    issuerUrl: null,
    privateKey,
    publicKey,
    jwk: { ...jwk, alg: "RS256", kid: `${name}-rs256`, use: "sig" },
  };
}

function getStudentEd25519(name) {
  ensureDir();
  return loadOrCreateEd25519(`student-${name}`);
}

module.exports = {
  getIssuerKeypair,
  getStudentEd25519,
  didKeyFromPublicKey,
  didKeyFromRaw,
  rawEd25519Pub,
  ISSUER_IDS,
};
