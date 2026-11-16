const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "wallet.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migração idempotente: coluna role (student | institution | admin)
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("role")) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'");
}

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  enc_priv TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_hash TEXT,
  signature TEXT,
  recovered_address TEXT,
  tx_hash TEXT,
  valid INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Seed automático do admin (plataforma): senha via WALLET_ADMIN_PASS, default admin123
const adminUser = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
if (!adminUser) {
  const crypto = require("node:crypto");
  const { hashPassword } = require("./auth");
  const { salt, hash } = hashPassword(process.env.WALLET_ADMIN_PASS || "admin123");
  db.prepare("INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (?, 'admin', ?, ?, 'admin')")
    .run(crypto.randomUUID(), hash, salt);
  console.log("[wallet-server] admin seed criado: username=admin, senha via WALLET_ADMIN_PASS (default admin123)");
}

module.exports = db;
