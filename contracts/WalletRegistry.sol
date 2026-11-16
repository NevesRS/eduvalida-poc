// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WalletRegistry
 * @notice PROVA DE CONCEITO — vínculo 1:1 entre carteira (address) e usuário
 *         (ownerIdHash = keccak256(username)).
 *
 *         Fluxo de assinatura/validação:
 *         1. Carteira assina (EIP-191) o digest de keccak256("EduValida:" + ownerIdHash + address)
 *         2. register() valida a assinatura via ecrecover — apenas o DONO da chave
 *            privada pode registrar o vínculo
 *         3. Qualquer pessoa consulta owners(wallet) para descobrir quem pertence
 */
contract WalletRegistry {
    mapping(address => bytes32) public owners;      // wallet -> ownerIdHash
    mapping(bytes32 => address) public walletOf;    // ownerIdHash -> wallet
    uint256 public totalRegistered;

    event WalletRegistered(address indexed wallet, bytes32 indexed ownerIdHash);

    /// @notice Registra o vínculo carteira -> usuário, validando a assinatura EIP-191.
    function register(bytes32 ownerIdHash, bytes calldata signature) external {
        require(owners[msg.sender] == bytes32(0), "WalletRegistry: carteira ja registrada");
        require(walletOf[ownerIdHash] == address(0), "WalletRegistry: usuario ja possui carteira");

        bytes32 messageHash = keccak256(abi.encodePacked("EduValida:", ownerIdHash, msg.sender));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        require(signature.length == 65, "WalletRegistry: assinatura malformada");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;

        address signer = ecrecover(ethSignedHash, v, r, s);
        require(signer != address(0), "WalletRegistry: assinatura invalida");
        require(signer == msg.sender, "WalletRegistry: assinatura nao pertence ao remetente");

        owners[msg.sender] = ownerIdHash;
        walletOf[ownerIdHash] = msg.sender;
        totalRegistered++;
        emit WalletRegistered(msg.sender, ownerIdHash);
    }

    /// @notice Consulta: a qual usuário (ownerIdHash) esta carteira pertence.
    function ownerOf(address wallet) external view returns (bytes32) {
        return owners[wallet];
    }

    function isRegistered(address wallet) external view returns (bool) {
        return owners[wallet] != bytes32(0);
    }
}
