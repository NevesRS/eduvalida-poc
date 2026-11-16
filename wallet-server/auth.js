const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, row) {
  const { hash } = hashPassword(password, row.password_salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.password_hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function issueToken(userId, username, role = "student") {
  return jwt.sign({ sub: userId, username, role }, JWT_SECRET, { expiresIn: "12h", jwtid: crypto.randomUUID() });
}

function requireAuth(req, res, next) {
  const header = req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "token ausente" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    if (!req.auth.role) return res.status(401).json({ error: "sessão antiga sem role — faça login novamente" });
    next();
  } catch {
    return res.status(401).json({ error: "token inválido ou expirado" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: `requer role: ${roles.join(" ou ")}` });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth, requireRole };
