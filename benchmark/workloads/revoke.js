const { ethers } = require("hardhat");

async function setup(contract, signers) {
  // Pre-create skills to revoke later
  const [, institution] = signers;
  const skillNames = [];
  for (let i = 0; i < 60; i++) {
    const name = `RevokeSkill_${i}_${Date.now()}`;
    await contract.createSkill(name);
    skillNames.push(name);
  }
  return { skillNames, index: 0 };
}

async function createTx(contract, signers, context, roundContext) {
  const [, institution] = signers;
  const student = signers[3];
  const idx = roundContext.index % roundContext.skillNames.length;
  const name = roundContext.skillNames[idx];
  const skillType = ethers.keccak256(ethers.toUtf8Bytes(name));

  // Ensure the student has the skill
  const balance = await contract.balanceOf(student.address, await contract.skillId(skillType, institution.address));
  if (balance === 0n) {
    await contract.connect(institution).issueSkill(student.address, skillType);
  }

  roundContext.index++;

  return {
    fn: () => contract.connect(institution).revoke(student.address, skillType),
  };
}

module.exports = { setup, createTx };
