// Smoke test do fluxo real do módulo de carteiras: registro 1:1 -> admin/emissores
// -> skills -> certificado consensual EIP-5484 -> revogação guiada por BurnAuth.
// Uso: node wallet-server/smoke.js [baseUrl]
const BASE = process.argv[2] || "http://localhost:3002";

async function call(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const username = "aluno_" + Date.now().toString(36);
  const password = "senha-secreta-123";

  console.log("[1] health:", JSON.stringify(await call("/chain/health")));

  console.log("\n[2] register (gera carteira + registra na blockchain):");
  const reg = await call("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) });
  console.log("    wallet:", reg.wallet.address);
  console.log("    registration tx:", reg.registration.txHash, "bloco", reg.registration.blockNumber);
  const auth = { Authorization: `Bearer ${reg.token}` };

  console.log("\n[3] login com a mesma conta:");
  const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  console.log("    wallet no login:", login.wallet.address);
  if (login.wallet.address.toLowerCase() !== reg.wallet.address.toLowerCase()) throw new Error("wallet do login nao bate!");

  console.log("\n[4] login do admin da plataforma:");
  const adminLogin = await call("/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: process.env.WALLET_ADMIN_PASS || "admin123" }) });
  const adminAuth = { Authorization: `Bearer ${adminLogin.token}` };
  if (adminLogin.user.role !== "admin") throw new Error("admin seed não tem role admin!");
  console.log("    role:", adminLogin.user.role);

  console.log("\n[5] admin cria skill (exclusivo do admin):");
  const skill = await call("/chain/create-skill", { method: "POST", headers: adminAuth, body: JSON.stringify({ name: "Skill Smoke " + Date.now() }) });
  console.log("    skillType:", skill.skillType);
  try {
    await call("/chain/create-skill", { method: "POST", headers: auth, body: JSON.stringify({ name: "nao-deveria-passar" }) });
    throw new Error("create-skill sem admin passou — BUG!");
  } catch (e) {
    if (!String(e.message).includes("requer role")) throw e;
    console.log("    ok: aluno não-admin recebe 403");
  }

  console.log("\n[6] admin registra instituição e autoriza como emissor:");
  const instUsername = "inst_" + Date.now().toString(36);
  const instReg = await call("/auth/register", { method: "POST", body: JSON.stringify({ username: instUsername, password, role: "institution" }) });
  const instAuth = { Authorization: `Bearer ${instReg.token}` };
  const authorized = await call(`/admin/institutions/${instReg.user.id}/authorize`, { method: "POST", headers: adminAuth });
  console.log("    ", JSON.stringify(authorized));

  console.log("\n[7] emitir skill com a carteira da instituição (role=institution):");
  const issued = await call("/chain/issue-skill", { method: "POST", headers: instAuth, body: JSON.stringify({ student: reg.wallet.address, skillType: skill.skillType }) });
  console.log("    tx:", issued.txHash, "bloco", issued.blockNumber);

  console.log("\n[8] quem atestou (on-chain -> WalletRegistry):");
  const att = await call(`/chain/attestations/${reg.wallet.address}/${skill.skillType}`);
  console.log("    ", JSON.stringify(att.attestations), `(${att.count}/${att.threshold})`);
  const first = att.attestations[0];
  if (!first || first.username !== instUsername || !first.registered) throw new Error("atestado não resolvido para o dono!");

  console.log("\n[9] admin: criar tipo de certificado com BurnAuth=Both + threshold + badge:");
  const cert = await call("/chain/create-cert-type", { method: "POST", headers: adminAuth, body: JSON.stringify({ name: "Cert Smoke " + Date.now(), skills: [skill.skillType], burnAuth: 2 }) });
  console.log("    certTypeId:", cert.id, "burnAuth:", cert.burnAuthName);
  const thr = await call("/admin/skill-threshold", { method: "POST", headers: adminAuth, body: JSON.stringify({ threshold: 1 }) });
  console.log("    threshold tx:", thr.txHash.slice(0, 10) + "...");
  const badge = await call("/admin/skill-badge", { method: "POST", headers: adminAuth, body: JSON.stringify({ skillType: skill.skillType, uri: "https://example.org/badge/" + Date.now() }) });
  console.log("    badge skill tx:", badge.txHash.slice(0, 10) + "...");

  console.log("\n[10] aluno: Minhas Skills (/me/skills):");
  const mySkills = await call("/me/skills", { method: "GET", headers: auth });
  const mySkill = mySkills.skills.find((s) => s.skillType === skill.skillType);
  if (!mySkill || !mySkill.has || mySkill.badgeUri === "") throw new Error("minha skill não veio com badge/has!");
  console.log("    ", mySkill.name, "has:", mySkill.has, "badgeUri:", mySkill.badgeUri.slice(0, 40) + "...");

  console.log("\n[11] aluno assina o CONSENTIMENTO (EIP-5484) e a instituição emite:");
  const consent = await call("/sign/consent", { method: "POST", headers: auth, body: JSON.stringify({ certTypeId: cert.id, issuer: instReg.wallet.address }) });
  console.log("    digest:", consent.digest);
  const certificate = await call("/chain/issue-cert", { method: "POST", headers: instAuth, body: JSON.stringify({ certTypeId: cert.id, student: reg.wallet.address, consentSignature: consent.signature }) });
  console.log("    tx:", certificate.txHash, "tokenId:", certificate.tokenId, "burnAuth:", certificate.burnAuth);

  console.log("\n[12] aluno: Meus Certificados (/me/certificates):");
  const myCerts = await call("/me/certificates", { method: "GET", headers: auth });
  const myCert = myCerts.certificates.find((c) => c.certTypeId === cert.id);
  if (!myCert || myCert.burnAuthName !== "Both" || myCert.issuer.toLowerCase() !== instReg.wallet.address.toLowerCase()) throw new Error("meu certificado não bateu!");
  console.log("    ", myCert.name, "tokenId:", myCert.tokenId, "BurnAuth:", myCert.burnAuthName);

  console.log("\n[13] consentimento forjado deve falhar (consentimento de OUTRO tipo de certificado):");
  const cert2 = await call("/chain/create-cert-type", { method: "POST", headers: adminAuth, body: JSON.stringify({ name: "Cert Smoke Forged " + Date.now(), skills: [skill.skillType], burnAuth: 2 }) });
  // aluno assina consentimento para cert.id, mas a instituição submete para cert2 — digest não bate
  const wrongConsent = await call("/sign/consent", { method: "POST", headers: auth, body: JSON.stringify({ certTypeId: cert.id, issuer: instReg.wallet.address }) });
  try {
    await call("/chain/issue-cert", { method: "POST", headers: instAuth, body: JSON.stringify({ certTypeId: cert2.id, student: reg.wallet.address, consentSignature: wrongConsent.signature }) });
    throw new Error("emissao com consentimento de outro tipo passou — BUG!");
  } catch (e) {
    if (!String(e.message).includes("consentimento invalido")) throw e;
    console.log("    ok: revert 'consentimento invalido' (digest liga certTypeId + emissor)");
  }

  console.log("\n[14] revogação por aluno+tipo (BurnAuth=Both, instituição queima):");
  const revoked = await call("/chain/revoke-cert", { method: "POST", headers: instAuth, body: JSON.stringify({ student: reg.wallet.address, certTypeId: cert.id }) });
  console.log("    tx:", revoked.txHash, "tokenId resolvido:", revoked.tokenId);
  const myCertsAfter = await call("/me/certificates", { method: "GET", headers: auth });
  if (myCertsAfter.certificates.some((c) => c.certTypeId === cert.id)) throw new Error("certificado ainda listado após revogação!");

  console.log("\n[15] emissores autorizados on-chain (resolvidos via WalletRegistry):");
  const issuers = await call("/chain/authorized-issuers");
  console.log("    ", JSON.stringify(issuers));
  if (!issuers.some((i) => i.username === instUsername)) throw new Error("emissor autorizado não listado!");

  console.log("\n[16] admin revoga a instituição:");
  const revokeIssuer = await call(`/admin/institutions/${instReg.user.id}/revoke`, { method: "POST", headers: adminAuth });
  console.log("    ", JSON.stringify(revokeIssuer));

  console.log("\nSMOKE OK — fluxo 1:1 + 5484 consensual + admin completo ✔");
}

main().catch((e) => {
  console.error("\nSMOKE FALHOU:", e.message);
  process.exit(1);
});
