const db = require("./db");
const { getIssuerKeypair, getStudentEd25519, didKeyFromPublicKey } = require("./keys");
const { BASE_URL } = require("./issuer");

function seed() {
  // Instituições
  const institutions = [
    { id: "institution1", name: "Instituição 1" },
    { id: "institution2", name: "Instituição 2" },
    { id: "admin", name: "Admin" },
  ];
  for (const inst of institutions) {
    db.prepare("INSERT OR REPLACE INTO institutions (id, name, issuer_url) VALUES (?, ?, ?)").run(
      inst.id,
      inst.name,
      `${BASE_URL}/issuers/${inst.id}`
    );
    getIssuerKeypair(inst.id);
  }

  // Skills demo
  const skills = ["Solidity Basics", "Smart Contract Security", "Ethereum Development"];
  for (const name of skills) {
    const existing = db.prepare("SELECT id FROM skills WHERE name = ?").get(name);
    if (!existing) {
      const info = db.prepare("INSERT INTO skills (name, achievement_url) VALUES (?, ?)").run(name, "placeholder");
      db.prepare("UPDATE skills SET achievement_url = ? WHERE id = ?").run(`${BASE_URL}/achievements/${info.lastInsertRowid}`, info.lastInsertRowid);
    }
  }

  // Cert type demo (se não existir)
  const existingCert = db.prepare("SELECT id FROM cert_types WHERE name = ?").get("Blockchain Developer");
  if (!existingCert) {
    const skillRows = db.prepare("SELECT id FROM skills WHERE name IN (?, ?, ?)").all(...skills);
    const skillIds = skillRows.map((r) => r.id);
    db.prepare("INSERT INTO cert_types (name, required_skills, required_signers) VALUES (?, ?, ?)").run(
      "Blockchain Developer",
      JSON.stringify(skillIds),
      JSON.stringify(["institution1", "institution2"])
    );
  }

  // Student demo (did:key a partir de Ed25519)
  const kp = getStudentEd25519("demo");
  const studentDid = didKeyFromPublicKey(kp.publicKey);

  console.log("Seed concluído.");
  console.log(`Student DID (demo): ${studentDid}`);
  console.log(`Institutions: ${institutions.map((i) => i.id).join(", ")}`);
  console.log(`Skills: ${skills.join(", ")}`);
}

if (require.main === module) seed();
module.exports = { seed };
