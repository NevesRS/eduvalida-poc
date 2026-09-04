const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Multi-Signature", function () {
  let deployer, instA, instB, instC, student;

  const SKILL_NAME = "Solidity Basics";
  const SKILL_TYPE = ethers.keccak256(ethers.toUtf8Bytes(SKILL_NAME));
  const CERT_NAME = "Blockchain Developer";

  let skillToken, certEmitter;

  beforeEach(async function () {
    [deployer, instA, instB, instC, student] = await ethers.getSigners();

    const SkillToken = await ethers.getContractFactory("SkillToken");
    skillToken = await SkillToken.deploy();

    const CertificateEmitter = await ethers.getContractFactory("CertificateEmitter");
    certEmitter = await CertificateEmitter.deploy(await skillToken.getAddress());

    // authorizar instituições
    await skillToken.setIssuer(instA.address, true);
    await skillToken.setIssuer(instB.address, true);
    await skillToken.setIssuer(instC.address, true);

    // criar skill
    await skillToken.createSkill(SKILL_NAME);

    // transferir ownership do certEmitter para instA
    await certEmitter.transferOwnership(instA.address);
  });

  // ─── SKILL TOKEN THRESHOLD ───────────────────────────────────

  describe("SkillToken — Threshold", function () {
    it("default threshold é 1", async function () {
      expect(await skillToken.skillThreshold()).to.equal(1n);
    });

    it("owner pode alterar threshold", async function () {
      await skillToken.setSkillThreshold(2);
      expect(await skillToken.skillThreshold()).to.equal(2n);
    });

    it("emite SkillThresholdUpdated", async function () {
      await expect(skillToken.setSkillThreshold(3))
        .to.emit(skillToken, "SkillThresholdUpdated")
        .withArgs(3);
    });

    it("reverte se não for owner", async function () {
      await expect(
        skillToken.connect(instA).setSkillThreshold(2)
      ).to.be.revertedWithCustomError(skillToken, "OwnableUnauthorizedAccount");
    });

    it("reverte se threshold = 0", async function () {
      await expect(skillToken.setSkillThreshold(0))
        .to.be.revertedWith("SkillToken: threshold deve ser > 0");
    });

    it("hasSkill retorna true com 1 assinatura (threshold=1)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      expect(await skillToken.hasSkill(student.address, SKILL_TYPE)).to.be.true;
    });

    it("hasSkill retorna false com 1 assinatura (threshold=2)", async function () {
      await skillToken.setSkillThreshold(2);
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      expect(await skillToken.hasSkill(student.address, SKILL_TYPE)).to.be.false;
    });

    it("hasSkill retorna true com 2 assinaturas (threshold=2)", async function () {
      await skillToken.setSkillThreshold(2);
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);
      expect(await skillToken.hasSkill(student.address, SKILL_TYPE)).to.be.true;
    });

    it("skillAttestationCount retorna contagem correta", async function () {
      await skillToken.setSkillThreshold(2);
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      expect(await skillToken.skillAttestationCount(student.address, SKILL_TYPE)).to.equal(1n);

      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      expect(await skillToken.skillAttestationCount(student.address, SKILL_TYPE)).to.equal(2n);
    });

    it("revogação de uma assinatura reduz a contagem", async function () {
      await skillToken.setSkillThreshold(2);
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      expect(await skillToken.hasSkill(student.address, SKILL_TYPE)).to.be.true;

      await skillToken.connect(instA).revoke(student.address, SKILL_TYPE);

      expect(await skillToken.skillAttestationCount(student.address, SKILL_TYPE)).to.equal(1n);
      expect(await skillToken.hasSkill(student.address, SKILL_TYPE)).to.be.false;
    });
  });

  // ─── SKILL TOKEN HAS SKILL FROM ─────────────────────────────

  describe("SkillToken — hasSkillFrom", function () {
    it("retorna true se a instituição específica emitiu", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      expect(await skillToken.hasSkillFrom(instA.address, student.address, SKILL_TYPE)).to.be.true;
    });

    it("retorna false se a instituição NÃO emitiu", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      expect(await skillToken.hasSkillFrom(instB.address, student.address, SKILL_TYPE)).to.be.false;
    });
  });

  // ─── SKILL TOKEN getIssuersList ──────────────────────────────

  describe("SkillToken — getIssuersList", function () {
    it("retorna todas as instituições autorizadas", async function () {
      const list = await skillToken.getIssuersList();
      expect(list.length).to.equal(3);
      expect(list).to.include(instA.address);
      expect(list).to.include(instB.address);
      expect(list).to.include(instC.address);
    });
  });

  // ─── CERTIFICATE EMITTER REQUIRED SIGNERS ────────────────────

  describe("CertificateEmitter — Required Signers", function () {
    let certTypeId;

    beforeEach(async function () {
      // criar cert type (instA é owner)
      await certEmitter.connect(instA).createCertificateType(CERT_NAME, [SKILL_TYPE]);
      certTypeId = 1n;
    });

    it("owner define signatários", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);
      const signers = await certEmitter.getRequiredSigners(certTypeId);
      expect(signers.length).to.equal(2);
      expect(signers).to.include(instA.address);
      expect(signers).to.include(instB.address);
    });

    it("emite RequiredSignersSet", async function () {
      await expect(
        certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address])
      ).to.emit(certEmitter, "RequiredSignersSet");
    });

    it("reverte se não for owner", async function () {
      await expect(
        certEmitter.connect(instB).setRequiredSigners(certTypeId, [instA.address])
      ).to.be.revertedWithCustomError(certEmitter, "OwnableUnauthorizedAccount");
    });

    it("reverte se certTypeId não existe", async function () {
      await expect(
        certEmitter.connect(instA).setRequiredSigners(999, [instA.address])
      ).to.be.revertedWith("CertificateEmitter: tipo de certificado inexistente");
    });

    it("allSignersSigned retorna true sem signatários definidos", async function () {
      expect(await certEmitter.allSignersSigned(student.address, certTypeId)).to.be.true;
    });

    it("allSignersSigned retorna false se falta signatário", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      // instA emitiu, instB não
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      expect(await certEmitter.allSignersSigned(student.address, certTypeId)).to.be.false;
    });

    it("allSignersSigned retorna true se todos assinaram", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      expect(await certEmitter.allSignersSigned(student.address, certTypeId)).to.be.true;
    });

    it("missingSigners retorna signatários pendentes", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address, instC.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      // instB e instC não emitiram

      const missing = await certEmitter.missingSigners(student.address, certTypeId);
      expect(missing.length).to.equal(2);
      expect(missing).to.include(instB.address);
      expect(missing).to.include(instC.address);
    });

    it("missingSigners retorna array vazio se todos assinaram", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const missing = await certEmitter.missingSigners(student.address, certTypeId);
      expect(missing.length).to.equal(0);
    });

    it("claimCertificate reverte se signatário falta", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      // instA emitiu, instB não — mas skillThreshold=1 então hasSkill retorna true
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      await expect(
        certEmitter.connect(student).claimCertificate(certTypeId)
      ).to.be.revertedWith("CertificateEmitter: signatarios pendentes");
    });

    it("claimCertificate funciona quando todos assinaram", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const tx = await certEmitter.connect(student).claimCertificate(certTypeId);
      const receipt = await tx.wait();

      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
    });

    it("claimCertificate funciona sem signatários definidos (comportamento legado)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      const tx = await certEmitter.connect(student).claimCertificate(certTypeId);
      await tx.wait();

      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
    });
  });

  // ─── INTEGRAÇÃO THRESHOLD + SIGNERS ─────────────────────────

  describe("Integração: Threshold + Signers", function () {
    let certTypeId;

    beforeEach(async function () {
      await skillToken.setSkillThreshold(2);
      await certEmitter.connect(instA).createCertificateType(CERT_NAME, [SKILL_TYPE]);
      certTypeId = 1n;
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);
    });

    it("claim falha com 1 de 2 assinaturas (threshold)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      await expect(
        certEmitter.connect(student).claimCertificate(certTypeId)
      ).to.be.revertedWith("CertificateEmitter: requisito de skill nao cumprido");
    });

    it("claim falha com 2 assinaturas mas 1 signatário pendente", async function () {
      // instA e instB emitiram → hasSkill = true (threshold atingido)
      // mas definimos requiredSigners = [instA, instB, instC] — instC não emitiu
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address, instC.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      await expect(
        certEmitter.connect(student).claimCertificate(certTypeId)
      ).to.be.revertedWith("CertificateEmitter: signatarios pendentes");
    });

    it("claim funciona com threshold + todos signatários", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      await certEmitter.connect(student).claimCertificate(certTypeId);
      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
    });
  });
});
