"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const SKILL_NAME = "Bench SetSkillName Target";

class SetSkillNameWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.skillType = Web3.utils.keccak256(SKILL_NAME);
    this.txIndex = 0;
  }

  async submitTransaction() {
    // Reescreve o nome do mesmo skillType (SSTORE em slot existente)
    const name = `${SKILL_NAME} v${this.txIndex++ % 3}`;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "setSkillName",
      args: [this.skillType, name],
    });
  }
}

module.exports = { createWorkloadModule: () => new SetSkillNameWorkload() };
