const { expect } = require("chai");
const { ethers } = require("hardhat");

// Assinatura de consentimento (EIP-5484) — mesmos bytes do abi.encodePacked on-chain
async function signConsent(student, certTypeId, issuer) {
  const digest = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "address", "address"],
      ["EduValidaConsent:", certTypeId, student.address, issuer]
    )
  );
  return student.signMessage(ethers.getBytes(digest));
}

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
      // criar cert type (instA é owner) — BurnAuth.IssuerOnly por padrão nos testes
      await certEmitter.connect(instA).createCertificateType(CERT_NAME, [SKILL_TYPE], 0); // 0 = IssuerOnly
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

    it("issueCertificate reverte se signatário falta", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      // instA emitiu, instB não — mas skillThreshold=1 então hasSkill retorna true
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent)
      ).to.be.revertedWith("CertificateEmitter: signatarios pendentes");
    });

    it("issueCertificate funciona quando todos assinaram", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      const tx = await certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent);
      await tx.wait();

      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
      expect(await certEmitter.ownerOf(1n)).to.equal(student.address);
      expect(await certEmitter.tokenIssuer(1n)).to.equal(instA.address);
      expect(await certEmitter.burnAuth(1n)).to.equal(0n); // IssuerOnly
    });

    it("issueCertificate emite eventos 5484 (Issued + CertificateIssued)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      const consent = await signConsent(student, certTypeId, instA.address);

      await expect(certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent))
        .to.emit(certEmitter, "Issued")
        .withArgs(instA.address, student.address, 1n, 0n)
        .and.to.emit(certEmitter, "CertificateIssued");
    });

    it("consentimento inválido reverte (assinado por outra conta)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      // instB assina o consentimento no lugar do aluno
      const badConsent = await signConsent(instB, certTypeId, instA.address);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, badConsent)
      ).to.be.revertedWith("CertificateEmitter: consentimento invalido");
    });

    it("consentimento com tamanho errado reverte", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, "0x1234")
      ).to.be.revertedWith("CertificateEmitter: consentimento invalido");
    });

    it("consentimento para outra instituição não vale (bind issuer)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      // aluno assina consentimento para (certTypeId, ele, instB), mas instA submete
      const consentForB = await signConsent(student, certTypeId, instB.address);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consentForB)
      ).to.be.revertedWith("CertificateEmitter: consentimento invalido");
    });

    it("issueCertificate não pode ser chamado por não-emissor", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      const consent = await signConsent(student, certTypeId, instA.address);
      // deployer não é emissor autorizado no SkillToken
      await expect(
        certEmitter.connect(deployer).issueCertificate(certTypeId, student.address, consent)
      ).to.be.revertedWith("CertificateEmitter: emissor nao autorizado");
    });

    it("não emite duas vezes (hasClaimed)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      const consent = await signConsent(student, certTypeId, instA.address);

      await certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent)
      ).to.be.revertedWith("CertificateEmitter: certificado ja emitido");
    });

    it("revokeCertificate com IssuerOnly: só a instituição emissora revoga", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      const consent = await signConsent(student, certTypeId, instA.address);
      await certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent);

      await expect(
        certEmitter.connect(student).revokeCertificate(1n)
      ).to.be.revertedWith("CertificateEmitter: burnAuth nao permite revogacao");

      await certEmitter.connect(instA).revokeCertificate(1n);
      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.false;
    });

    it("issueCertificate funciona sem signatários definidos (comportamento legado)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      const tx = await certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent);
      await tx.wait();

      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
    });
  });

  // ─── INTEGRAÇÃO THRESHOLD + SIGNERS ─────────────────────────

  describe("Integração: Threshold + Signers + BurnAuth", function () {
    let certTypeId;

    beforeEach(async function () {
      await skillToken.setSkillThreshold(2);
      await certEmitter.connect(instA).createCertificateType(CERT_NAME, [SKILL_TYPE], 0); // IssuerOnly
      certTypeId = 1n;
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address]);
    });

    it("issue falha com 1 de 2 assinaturas (threshold)", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent)
      ).to.be.revertedWith("CertificateEmitter: requisito de skill nao cumprido");
    });

    it("issue falha com 2 assinaturas mas 1 signatário pendente", async function () {
      await certEmitter.connect(instA).setRequiredSigners(certTypeId, [instA.address, instB.address, instC.address]);

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      await expect(
        certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent)
      ).to.be.revertedWith("CertificateEmitter: signatarios pendentes");
    });

    it("issue funciona com threshold + todos signatários", async function () {
      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId, instA.address);
      await certEmitter.connect(instA).issueCertificate(certTypeId, student.address, consent);
      expect(await certEmitter.hasClaimed(student.address, certTypeId)).to.be.true;
    });

    it("BurnAuth.Both: aluno e instituição podem revogar", async function () {
      const tx = await certEmitter.connect(instA).createCertificateType(CERT_NAME + " Both", [SKILL_TYPE], 2);
      const certTypeId2 = (await tx.wait()).logs
        .map((l) => { try { return certEmitter.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find((p) => p.name === "CertificateTypeCreated").args.certTypeId;

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId2, instA.address);
      await certEmitter.connect(instA).issueCertificate(certTypeId2, student.address, consent);
      const tokenId = await certEmitter.studentTokenId(student.address, certTypeId2);
      expect(await certEmitter.burnAuth(tokenId)).to.equal(2n);

      // aluno revoga (IssuerOnly seria proibido, Both permite)
      await certEmitter.connect(student).revokeCertificate(tokenId);
      expect(await certEmitter.hasClaimed(student.address, certTypeId2)).to.be.false;
    });

    it("BurnAuth.Neither: ninguém revoga", async function () {
      const tx = await certEmitter.connect(instA).createCertificateType(CERT_NAME + " Locked", [SKILL_TYPE], 3);
      const certTypeId3 = (await tx.wait()).logs
        .map((l) => { try { return certEmitter.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find((p) => p.name === "CertificateTypeCreated").args.certTypeId;

      await skillToken.connect(instA).issueSkill(student.address, SKILL_TYPE);
      await skillToken.connect(instB).issueSkill(student.address, SKILL_TYPE);

      const consent = await signConsent(student, certTypeId3, instA.address);
      await certEmitter.connect(instA).issueCertificate(certTypeId3, student.address, consent);
      const tokenId = await certEmitter.studentTokenId(student.address, certTypeId3);

      await expect(
        certEmitter.connect(instA).revokeCertificate(tokenId)
      ).to.be.revertedWith("CertificateEmitter: burnAuth nao permite revogacao");
      await expect(
        certEmitter.connect(student).revokeCertificate(tokenId)
      ).to.be.revertedWith("CertificateEmitter: burnAuth nao permite revogacao");
    });
  });
});
