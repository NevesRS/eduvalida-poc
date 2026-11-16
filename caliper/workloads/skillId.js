"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const INSTITUTION = "0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73";

class SkillIdWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.skillTypes = (roundArguments && roundArguments.skillTypes) || [Web3.utils.keccak256("Bench SkillId")];
    this.txIndex = 0;
  }

  async submitTransaction() {
    const skillType = this.skillTypes[this.txIndex++ % this.skillTypes.length];

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "skillId",
      args: [skillType, INSTITUTION],
      readOnly: true,
    });
  }
}

module.exports = { createWorkloadModule: () => new SkillIdWorkload() };
