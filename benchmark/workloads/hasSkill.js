const { ethers } = require("hardhat");

async function setup(contract, signers) {
  const [, institution] = signers;
  const student = signers[3];

  // Pre-create and issue skills
  const skillTypes = [];
  for (let i = 0; i < 110; i++) {
    const name = `ViewSkill_${i}_${Date.now()}`;
    await contract.createSkill(name);
    const skillType = ethers.keccak256(ethers.toUtf8Bytes(name));
    await contract.connect(institution).issueSkill(student.address, skillType);
    skillTypes.push(skillType);
  }
  return { skillTypes, index: 0 };
}

async function createTx(contract, signers, context, roundContext) {
  const student = signers[3];
  const idx = roundContext.index % roundContext.skillTypes.length;
  const skillType = roundContext.skillTypes[idx];

  roundContext.index++;

  return {
    fn: () => contract.hasSkill(student.address, skillType),
  };
}

module.exports = { setup, createTx };
