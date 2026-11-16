const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "eduvalida-ob3.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issuer_url TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  achievement_url TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cert_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  required_skills TEXT NOT NULL DEFAULT '[]',
  required_signers TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_did TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  issuer_id TEXT NOT NULL,
  credential_jwt TEXT NOT NULL,
  status_index INTEGER,
  revoked INTEGER DEFAULT 0,
  issued_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_did, skill_id, issuer_id),
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  FOREIGN KEY (issuer_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS cert_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_did TEXT NOT NULL,
  cert_type_id INTEGER NOT NULL,
  credential_jwt TEXT NOT NULL,
  status_index INTEGER,
  revoked INTEGER DEFAULT 0,
  issued_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_did, cert_type_id),
  FOREIGN KEY (cert_type_id) REFERENCES cert_types(id)
);

CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  student_did TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS status_list (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bitstring BLOB NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

db.exec("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
const skillThresholdRow = db.prepare("SELECT value FROM config WHERE key = 'skill_threshold'");
const upsertThreshold = db.prepare(
  "INSERT INTO config (key, value) VALUES ('skill_threshold', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
if (!skillThresholdRow.get()) upsertThreshold.run("1");

module.exports = db;
