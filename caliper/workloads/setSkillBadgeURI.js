"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const SKILL_NAME = "Bench SetBadgeURI Target";

class SetSkillBadgeURIWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.skillType = Web3.utils.keccak256(SKILL_NAME);
    this.txIndex = 0;
  }

  async submitTransaction() {
    const uri = `https://eduvalida.poc/badges/${this.txIndex++ % 5}.json`;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "setSkillBadgeURI",
      args: [this.skillType, uri],
    });
  }
}

module.exports = { createWorkloadModule: () => new SetSkillBadgeURIWorkload() };
