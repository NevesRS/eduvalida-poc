"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const STUDENT = "0xf17f52151EbEF6C7334FAD080c5704D77216b732";
const DEPLOYER = "0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73";

// Getters públicos (state vars + ERC-6909) — round misturado
const GETTERS_6909 = [
  { verb: "balanceOf", args: [STUDENT, 1] },
  { verb: "skillNames", args: [Web3.utils.keccak256("Bench Getter")] },
  { verb: "skillBadgeURI", args: [Web3.utils.keccak256("Bench Getter")] },
  { verb: "authorizedIssuers", args: [DEPLOYER] },
  { verb: "idToSkillType", args: [1] },
  { verb: "idToIssuer", args: [1] },
  { verb: "skillThreshold", args: [] },
  { verb: "owner", args: [] },
  { verb: "isOperator", args: [STUDENT, DEPLOYER] },
  { verb: "allowance", args: [STUDENT, DEPLOYER, 1] },
  { verb: "supportsInterface", args: ["0x01ffc9a7"] }, // ERC-165
];

// Getters públicos da variante ERC-1155 (SkillTokenV1)
const GETTERS_1155 = [
  { verb: "balanceOf", args: [STUDENT, 1] },
  { verb: "balanceOfBatch", args: [[STUDENT], [1]] },
  { verb: "uri", args: [1] },
  { verb: "skillNames", args: [Web3.utils.keccak256("Bench Getter")] },
  { verb: "skillBadgeURI", args: [Web3.utils.keccak256("Bench Getter")] },
  { verb: "authorizedIssuers", args: [DEPLOYER] },
  { verb: "idToSkillType", args: [1] },
  { verb: "idToIssuer", args: [1] },
  { verb: "skillThreshold", args: [] },
  { verb: "owner", args: [] },
  { verb: "isApprovedForAll", args: [STUDENT, DEPLOYER] },
  { verb: "supportsInterface", args: ["0x01ffc9a7"] }, // ERC-165
];

class GettersWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.txIndex = 0;
    this.getters = this.contractKey === "SkillTokenV1" ? GETTERS_1155 : GETTERS_6909;
  }

  async submitTransaction() {
    const getter = this.getters[this.txIndex++ % this.getters.length];

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: getter.verb,
      args: getter.args,
      readOnly: true,
    });
  }
}

module.exports = { createWorkloadModule: () => new GettersWorkload() };
