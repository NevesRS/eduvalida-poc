const { verifyMessage, getBytes } = require("ethers");
const { digestOf, chainOwnerOf, ownerIdHashFrom } = require("./chain");
const db = require("./db");

// Assina mensagem (EIP-191) com a carteira autenticada
async function signMessage(wallet, messageBytes) {
  const digest = digestOf(messageBytes);
  return { digest, signature: await wallet.signMessage(getBytes(digest)) };
}

// Valida assinatura -> recupera endereço -> consulta na blockchain quem pertence
async function verifyMessageOf(messageBytes, signature) {
  const digest = digestOf(messageBytes);
  const recovered = verifyMessage(getBytes(digest), signature); // lança se inválida
  const ownerHash = await chainOwnerOf(recovered); // blockchain é a fonte de verdade
  const ZERO = "0x" + "0".repeat(64);
  if (ownerHash && ownerHash !== ZERO) {
    const local = db.prepare(
      "SELECT u.id, u.username FROM users u JOIN wallets w ON w.user_id = u.id WHERE LOWER(w.address) = ?"
    ).get(recovered.toLowerCase());
    const username = local ? local.username : null;
    const consistent = username ? ownerHash.toLowerCase() === ownerIdHashFrom(username).toLowerCase() : false;
    return { recoveredAddress: recovered, owner: { ownerIdHash: ownerHash, username, userId: local ? local.id : null, consistent } };
  }
  return { recoveredAddress: recovered, owner: null };
}

module.exports = { signMessage, verifyMessageOf };
