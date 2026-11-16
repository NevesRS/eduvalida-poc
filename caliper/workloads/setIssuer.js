"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");

// Instituição alternada — NUNCA o deployer (que deve permanecer issuer
// para os rounds de issueSkill/revoke)
const BENCH_ISSUER = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"; // institution2

class SetIssuerWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
    await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

    this.contractKey = (roundArguments && roundArguments.contractKey) || "SkillToken";

    this.contract = sutContext.contracts[this.contractKey].contract;
    this.deployer = sutContext.contractDeployerAddress;
    this.currentStatus = await this.contract.methods.authorizedIssuers(BENCH_ISSUER).call();
  }

  async submitTransaction() {
    // Alterna true/false — exercita os dois ramos (push e pop da lista)
    this.currentStatus = !this.currentStatus;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "setIssuer",
      args: [BENCH_ISSUER, this.currentStatus],
    });
  }
}

module.exports = { createWorkloadModule: () => new SetIssuerWorkload() };
