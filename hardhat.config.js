require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_KEY = "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63";
const INSTITUTION_KEY = "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3";
const INSTITUTION2_KEY = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";
const STUDENT_KEY = "0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
    },
  },
  networks: {
    besu: {
      url: "http://localhost:8545",
      chainId: 1337,
      accounts: [DEPLOYER_KEY, INSTITUTION_KEY, INSTITUTION2_KEY, STUDENT_KEY],
    },
  },
};
