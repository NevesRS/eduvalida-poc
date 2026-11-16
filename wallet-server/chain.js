const { ethers } = require("ethers");
const { RPC_URL, REGISTRY_ADDRESS, REGISTRY_MESSAGE_PREFIX } = require("./config");
const { id: keccak256Utf8, solidityPacked, getBytes, keccak256 } = require("ethers");

const REGISTRY_ABI = [
  "function owners(address) view returns (bytes32)",
  "function walletOf(bytes32) view returns (address)",
  "function totalRegistered() view returns (uint256)",
  "function register(bytes32 ownerIdHash, bytes signature)",
  "event WalletRegistered(address indexed wallet, bytes32 indexed ownerIdHash)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Blockchain é OBRIGATÓRIA no fluxo 1:1 — sem RPC, tudo falha com 503.
async function requireChain(req, res, next) {
  try {
    await provider.getBlockNumber();
    next();
  } catch {
    res.status(503).json({ error: "Blockchain indisponível: suba a rede Besu em http://localhost:8545" });
  }
}

function registry() {
  if (!REGISTRY_ADDRESS) return null;
  return new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
}

function assertRegistry(res) {
  if (!REGISTRY_ADDRESS) {
    res.status(503).json({ error: "WalletRegistry não deployado: rode npm run deploy:registry" });
    return false;
  }
  return true;
}

// ownerIdHash on-chain = keccak256(username) — vira o identificador do dono
function ownerIdHashFrom(username) {
  return keccak256Utf8(username);
}

// Mensagem assinada (mesmos bytes do abi.encodePacked on-chain)
function buildRegistrationMessage(ownerIdHash, walletAddress) {
  return solidityPacked(["string", "bytes32", "address"], [REGISTRY_MESSAGE_PREFIX, ownerIdHash, walletAddress]);
}

function digestOf(messageBytes) {
  return keccak256(getBytes(messageBytes));
}

// owner on-chain de um endereço: bytes32 (0x000...0 = não registrado)
async function chainOwnerOf(address) {
  const reg = registry();
  if (!reg) return null;
  return reg.owners(address);
}

async function chainInfo() {
  const [chainId, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  return { rpc: true, chainId: Number(chainId.chainId), blockNumber, walletRegistry: REGISTRY_ADDRESS };
}

module.exports = { provider, REGISTRY_ABI, requireChain, registry, assertRegistry, ownerIdHashFrom, buildRegistrationMessage, digestOf, chainOwnerOf, chainInfo };
