"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");

class CreateSkillWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.deployer = sutContext.contractDeployerAddress;
    this.txIndex = 0;
  }

  async submitTransaction() {
    // Nome único por tx — createSkill reverte se o skillType já existe
    const name = `BenchCreate_r${this.roundIndex}_w${this.workerIndex}_${this.txIndex++}_${Date.now()}`;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "createSkill",
      args: [name],
    });
  }
}

module.exports = { createWorkloadModule: () => new CreateSkillWorkload() };
