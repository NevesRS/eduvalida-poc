"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");

class SetSkillThresholdWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.deployer = sutContext.contractDeployerAddress;
    this.txIndex = 0;
  }

  async cleanupWorkloadModule(roundIdx, args, env) {
    // Restaura o threshold original (1) para não afetar rounds posteriores
    try {
      await this.contract.methods.setSkillThreshold(1).send({
        from: this.deployer,
        gas: 60000,
      });
    } catch (e) { /* best-effort */ }
    await super.cleanupWorkloadModule(roundIdx, args, env);
  }

  async submitTransaction() {
    // Cicla 1 → 2 → 3 → 1 ... (threshold sempre > 0, exigência do contrato)
    const threshold = (this.txIndex++ % 3) + 1;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "setSkillThreshold",
      args: [threshold],
    });
  }
}

module.exports = { createWorkloadModule: () => new SetSkillThresholdWorkload() };
