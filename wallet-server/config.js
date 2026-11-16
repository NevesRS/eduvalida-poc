const crypto = require("node:crypto");
const path = require("node:path");
const { keccak256, id, getBytes, solidityPacked, verifyMessage, Transaction, Wallet } = require("ethers");

// ===== Config =====
const RPC_URL = process.env.BESU_RPC_URL || "http://localhost:8545";
const PORT = Number(process.env.WALLET_PORT || 3002);
let deployed = {};
try {
  deployed = require(path.join(__dirname, "..", "deployed-addresses.json"));
} catch {
  // deployed-addresses.json ausente (gitignored): rode npm run deploy:registry
}
const REGISTRY_ADDRESS = process.env.WALLET_REGISTRY || deployed.walletRegistry || null;
const SKILL_TOKEN_ADDRESS = process.env.SKILL_TOKEN || deployed.skillToken || null;
const CERT_EMITTER_ADDRESS = process.env.CERT_EMITTER || deployed.certificateEmitter || null;

// Chaves de administração da POC (já públicas no hardhat.config.js)
const DEPLOYER_KEY = process.env.DEPLOYER_KEY || "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63";
const INSTITUTION_KEY = process.env.INSTITUTION_KEY || "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3";
const JWT_SECRET = process.env.WALLET_JWT_SECRET || "eduvalida-poc-jwt-secret";
const KEK_PASSPHRASE = process.env.WALLET_KEK || "eduvalida-poc-kek";
const REGISTRY_MESSAGE_PREFIX = "EduValida:";

module.exports = { RPC_URL, PORT, REGISTRY_ADDRESS, SKILL_TOKEN_ADDRESS, CERT_EMITTER_ADDRESS, DEPLOYER_KEY, INSTITUTION_KEY, JWT_SECRET, KEK_PASSPHRASE, REGISTRY_MESSAGE_PREFIX, crypto, keccak256, id, getBytes, solidityPacked, verifyMessage, Transaction, Wallet };
