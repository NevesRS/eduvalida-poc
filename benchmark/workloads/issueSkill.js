const { ethers } = require("hardhat");

let skillCounter = 0;

async function setup(contract, signers) {
  const [, institution] = signers;
  const knownSkills = await contract.getKnownSkillTypes();
  // We'll create skills on demand in createTx
  return { counter: 0, knownSkills };
}

async function createTx(contract, signers, context) {
  const [, institution] = signers;
  const name = `Skill_${context.roundIndex}_${context.txIndex}_${Date.now()}`;
  await contract.createSkill(name);
  const skillType = ethers.keccak256(ethers.toUtf8Bytes(name));
  return {
    fn: () => contract.connect(institution).issueSkill(signers[3].address, skillType),
  };
}

module.exports = { setup, createTx };
