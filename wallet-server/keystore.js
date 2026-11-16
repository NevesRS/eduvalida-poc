const crypto = require("node:crypto");
const { Wallet, getBytes, hexlify, randomBytes } = require("ethers");
const { KEK_PASSPHRASE } = require("./config");

// Deriva uma chave AES-256 a partir do KEK (passphrase de env)
const KEK = crypto.scryptSync(KEK_PASSPHRASE, "eduvalida-wallet-kek-salt", 32);

function encryptPrivateKey(privateKeyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEK, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(privateKeyHex.slice(2), "hex")), cipher.final()]);
  return { enc_priv: enc.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptPrivateKey(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEK, Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.tag, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(row.enc_priv, "base64")), decipher.final()]);
  return "0x" + dec.toString("hex");
}

// Gera uma nova carteira EVM (chave nunca é retornada ao cliente)
function createEvmWallet() {
  const wallet = Wallet.createRandom();
  const enc = encryptPrivateKey(wallet.privateKey);
  return {
    id: crypto.randomUUID(),
    address: wallet.address.toLowerCase(),
    publicKey: wallet.signingKey.publicKey,
    privateKey: wallet.privateKey, // uso interno do servidor; nunca sai por API
    ...enc,
  };
}

// Reconstrói um ethers.Wallet a partir do registro cifrado no SQLite
function walletFromRow(row) {
  const pk = decryptPrivateKey(row);
  return new Wallet(pk);
}

function rawPubKey(publicKey) {
  return getBytes(publicKey).subarray(1); // remove prefixo 0x04
}

module.exports = { encryptPrivateKey, decryptPrivateKey, createEvmWallet, walletFromRow, rawPubKey, randomBytes, hexlify };
