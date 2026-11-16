"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const Web3 = require("web3");

const STUDENT = "0xf17f52151EbEF6C7334FAD080c5704D77216b732";

class SkillAttestationCountWorkload extends WorkloadModuleBase {
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

    // Cria uma skill e emite para o student (garante count >= 1)
    const name = `AttestCount_r${roundIndex}_w${workerIndex}_${Date.now()}`;
    await this.contract.methods.createSkill(name).send({ from: this.deployer, gas: 300000 });
    this.skillType = Web3.utils.keccak256(name);
    await this.contract.methods.issueSkill(STUDENT, this.skillType).send({ from: this.fromAddress, gas: 200000 });

    this.txIndex = 0;

    const currentNonce = await sutContext.web3.eth.getTransactionCount(this.fromAddress);
    sutContext.nonces[this.fromAddress] = currentNonce;
  }

  async submitTransaction() {
    this.txIndex++;

    await this.sutAdapter.sendRequests({
      contract: this.contractKey,
      verb: "skillAttestationCount",
      args: [STUDENT, this.skillType],
      readOnly: true,
    });
  }
}

module.exports = { createWorkloadModule: () => new SkillAttestationCountWorkload() };
