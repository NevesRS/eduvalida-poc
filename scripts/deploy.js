const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, institution, student] = await hre.ethers.getSigners();

  console.log("Deploying with deployer:", deployer.address);
  console.log("Institution:", institution.address);
  console.log("Student:", student.address);

  const SkillToken = await hre.ethers.getContractFactory("SkillToken");
  const skillToken = await SkillToken.deploy();
  await skillToken.waitForDeployment();
  const skillTokenAddr = await skillToken.getAddress();
  console.log("SkillToken deployed to:", skillTokenAddr);

  const CertificateEmitter = await hre.ethers.getContractFactory("CertificateEmitter");
  const certEmitter = await CertificateEmitter.deploy(skillTokenAddr);
  await certEmitter.waitForDeployment();
  const certEmitterAddr = await certEmitter.getAddress();
  console.log("CertificateEmitter deployed to:", certEmitterAddr);

  console.log("Authorizing institution as issuer...");
  const tx = await skillToken.setIssuer(institution.address, true);
  await tx.wait();
  console.log("Institution authorized.");

  console.log("Transferring CertificateEmitter ownership to institution...");
  const tx2 = await certEmitter.transferOwnership(institution.address);
  await tx2.wait();
  console.log("Ownership transferred.");

  const addresses = {
    skillToken: skillTokenAddr,
    certificateEmitter: certEmitterAddr,
    deployer: deployer.address,
    institution: institution.address,
    student: student.address,
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("Addresses saved to deployed-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
