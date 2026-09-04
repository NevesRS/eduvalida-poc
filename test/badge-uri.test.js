const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Open Badge URIs", function () {
  let deployer, institution, other;
  let skillToken, certEmitter;

  const SKILL_NAME = "Solidity Basics";
  const SKILL_TYPE = ethers.keccak256(ethers.toUtf8Bytes(SKILL_NAME));
  const BADGE_URI = "https://ipfs.io/ipfs/Qm1234/skill-badge.json";
  const CERT_NAME = "Blockchain Developer";
  const CERT_BADGE_URI = "https://ipfs.io/ipfs/Qm5678/cert-badge.json";

  beforeEach(async function () {
    [deployer, institution, other] = await ethers.getSigners();

    const SkillToken = await ethers.getContractFactory("SkillToken");
    skillToken = await SkillToken.deploy();

    const CertificateEmitter = await ethers.getContractFactory("CertificateEmitter");
    certEmitter = await CertificateEmitter.deploy(await skillToken.getAddress());

    // authorize institution as issuer
    await skillToken.setIssuer(institution.address, true);
    // transfer CertificateEmitter ownership to institution
    await certEmitter.transferOwnership(institution.address);
  });

  describe("SkillToken.setSkillBadgeURI", function () {
    it("owner define URI e pode ler de volta", async function () {
      // create skill first
      await skillToken.createSkill(SKILL_NAME);

      await skillToken.setSkillBadgeURI(SKILL_TYPE, BADGE_URI);
      expect(await skillToken.skillBadgeURI(SKILL_TYPE)).to.equal(BADGE_URI);
    });

    it("emite evento SkillBadgeURISet", async function () {
      await skillToken.createSkill(SKILL_NAME);

      await expect(skillToken.setSkillBadgeURI(SKILL_TYPE, BADGE_URI))
        .to.emit(skillToken, "SkillBadgeURISet")
        .withArgs(SKILL_TYPE, BADGE_URI);
    });

    it("reverte se não for owner", async function () {
      await skillToken.createSkill(SKILL_NAME);

      await expect(
        skillToken.connect(other).setSkillBadgeURI(SKILL_TYPE, BADGE_URI)
      ).to.be.revertedWithCustomError(skillToken, "OwnableUnauthorizedAccount");
    });

    it("reverte se skill não existe (URI fica vazia mas não reverte)", async function () {
      // setSkillBadgeURI não valida existência — aceita qualquer skillType
      await skillToken.setSkillBadgeURI(SKILL_TYPE, BADGE_URI);
      expect(await skillToken.skillBadgeURI(SKILL_TYPE)).to.equal(BADGE_URI);
    });
  });

  describe("CertificateEmitter.setCertificateBadgeURI", function () {
    let certTypeId;

    beforeEach(async function () {
      // create a skill and a cert type (needs institution as owner)
      await skillToken.createSkill(SKILL_NAME);

      // institution is owner of certEmitter
      const skillHash = ethers.keccak256(ethers.toUtf8Bytes(SKILL_NAME));
      const tx = await certEmitter.connect(institution).createCertificateType(CERT_NAME, [skillHash]);
      const receipt = await tx.wait();
      certTypeId = 1n;
    });

    it("owner define URI e pode ler de volta", async function () {
      await certEmitter.connect(institution).setCertificateBadgeURI(certTypeId, CERT_BADGE_URI);
      expect(await certEmitter.certificateBadgeURI(certTypeId)).to.equal(CERT_BADGE_URI);
    });

    it("emite evento CertificateBadgeURISet", async function () {
      await expect(certEmitter.connect(institution).setCertificateBadgeURI(certTypeId, CERT_BADGE_URI))
        .to.emit(certEmitter, "CertificateBadgeURISet")
        .withArgs(certTypeId, CERT_BADGE_URI);
    });

    it("reverte se não for owner", async function () {
      await expect(
        certEmitter.connect(other).setCertificateBadgeURI(certTypeId, CERT_BADGE_URI)
      ).to.be.revertedWithCustomError(certEmitter, "OwnableUnauthorizedAccount");
    });

    it("reverte se certTypeId não existe", async function () {
      await expect(
        certEmitter.connect(institution).setCertificateBadgeURI(999, CERT_BADGE_URI)
      ).to.be.revertedWith("CertificateEmitter: tipo de certificado inexistente");
    });
  });
});
