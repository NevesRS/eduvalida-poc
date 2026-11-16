"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const STUDENT = "0xf17f52151EbEF6C7334FAD080c5704D77216b732";

class HasSkillWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.fromAddress = sutContext.fromAddress;
    this.deployer = sutContext.contractDeployerAddress;

    const isIssuer = await this.contract.methods.authorizedIssuers(this.fromAddress).call();
    if (!isIssuer) {
      await this.contract.methods.setIssuer(this.fromAddress, true).send({ from: this.deployer, gas: 200000 });
    }

    // Pré-cria skills e emite para o student (para que hasSkill retorne true)
    const skillCount = (roundArguments && roundArguments.skillCount) || 10;
    this.skillTypes = [];
    for (let i = 0; i < skillCount; i++) {
      const name = `ViewSkill_r${roundIndex}_w${workerIndex}_i${i}_${Date.now()}`;
      await this.contract.methods.createSkill(name).send({ from: this.deployer, gas: 300000 });
      const skillType = Web3.utils.keccak256(name);
      await this.contract.methods.issueSkill(STUDENT, skillType).send({ from: this.fromAddress, gas: 200000 });
      this.skillTypes.push(skillType);
    }
    this.txIndex = 0;

    // Sincroniza o nonce cacheado pelo connector (setup usou .send() direto)
    const currentNonce = await sutContext.web3.eth.getTransactionCount(this.fromAddress);
    sutContext.nonces[this.fromAddress] = currentNonce;
  }

  async submitTransaction() {
    const skillType = this.skillTypes[this.txIndex % this.skillTypes.length];
    this.txIndex++;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "hasSkill",
      args: [STUDENT, skillType],
      readOnly: true,
    });
  }
}

module.exports = { createWorkloadModule: () => new HasSkillWorkload() };
