"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");

class GetIssuersListWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.txIndex = 0;
  }

  async submitTransaction() {
    this.txIndex++;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "getIssuersList",
      args: [],
      readOnly: true,
    });
  }
}

module.exports = { createWorkloadModule: () => new GetIssuersListWorkload() };
