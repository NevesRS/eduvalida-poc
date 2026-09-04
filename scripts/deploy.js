const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, institution, institution2, student] = await hre.ethers.getSigners();

  console.log("Deploying with deployer:", deployer.address);
  console.log("Institution 1:", institution.address);
  console.log("Institution 2:", institution2.address);
  console.log("Student:", student.address);

  // fund institution2 with ETH from deployer
  console.log("Funding institution2...");
  const fundTx = await deployer.sendTransaction({
    to: institution2.address,
    value: hre.ethers.parseEther("10"),
  });
  await fundTx.wait();
  console.log("Institution2 funded.");

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

  console.log("Authorizing institution1 as issuer...");
  const tx1 = await skillToken.setIssuer(institution.address, true);
  await tx1.wait();
  console.log("Institution1 authorized.");

  console.log("Authorizing institution2 as issuer...");
  const tx2 = await skillToken.setIssuer(institution2.address, true);
  await tx2.wait();
  console.log("Institution2 authorized.");

  console.log("Transferring CertificateEmitter ownership to institution1...");
  const tx3 = await certEmitter.transferOwnership(institution.address);
  await tx3.wait();
  console.log("Ownership transferred.");

  const addresses = {
    skillToken: skillTokenAddr,
    certificateEmitter: certEmitterAddr,
    deployer: deployer.address,
    institution: institution.address,
    institution2: institution2.address,
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
