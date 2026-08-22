// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./SkillToken.sol";

/// @notice Enum padrão do EIP-5484: define quem tem permissão de queimar o token.
enum BurnAuth { IssuerOnly, OwnerOnly, Both, Neither }

/// @notice Interface mínima do EIP-5484 (Consensual Soulbound Token).
interface IERC5484 {
    event Issued(address indexed from, address indexed to, uint256 indexed tokenId, BurnAuth burnAuth);
    function burnAuth(uint256 tokenId) external view returns (BurnAuth);
}

/**
 * @title CertificateEmitter
 * @notice PROVA DE CONCEITO — certificado final como token soulbound (ERC-5484),
 *         emitido quando o aluno já possui, em saldo ERC-1155 (SkillToken), todas
 *         as skills exigidas. Revogável apenas pelo emissor.
 *
 *         Simplificações assumidas (a substituir numa v2):
 *          - Sem verificação de trust/escopo por skill: qualquer saldo válido no
 *            contrato de origem é aceito.
 *          - Emissão/revogação controladas por um único owner, sem multi-assinatura
 *            institucional (a evoluir para quórum, como discutido para o certificado
 *            final na arquitetura completa).
 */
contract CertificateEmitter is ERC721, IERC5484, Ownable {
    SkillToken public immutable skillToken;

    struct CertificateType {
        string name;
        bytes32[] requiredSkills;
        bool exists;
    }

    mapping(uint256 => CertificateType) public certificateTypes;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(address => mapping(uint256 => uint256)) public studentTokenId;
    mapping(uint256 => uint256) private _tokenToCertType;
    uint256 private _nextCertTypeId;
    uint256 private _nextTokenId;

    event CertificateTypeCreated(uint256 indexed certTypeId, string name);
    event CertificateClaimed(address indexed student, uint256 indexed certTypeId, uint256 tokenId);
    event CertificateRevoked(address indexed student, uint256 indexed certTypeId, uint256 tokenId);

    constructor(address skillTokenAddress) ERC721("Certificado", "CERT") Ownable(msg.sender) {
        skillToken = SkillToken(skillTokenAddress);
    }

    /// @notice Instituição (owner) define um novo tipo de certificado e as skills exigidas.
    function createCertificateType(string calldata name, bytes32[] calldata requiredSkills)
        external
        onlyOwner
        returns (uint256 certTypeId)
    {
        require(requiredSkills.length > 0, "CertificateEmitter: defina ao menos 1 skill");

        certTypeId = ++_nextCertTypeId;
        certificateTypes[certTypeId] = CertificateType({
            name: name,
            requiredSkills: requiredSkills,
            exists: true
        });

        emit CertificateTypeCreated(certTypeId, name);
    }

    /// @notice Aluno reivindica o certificado se ja possuir todas as skills exigidas.
    function claimCertificate(uint256 certTypeId) external returns (uint256 tokenId) {
        CertificateType memory cert = certificateTypes[certTypeId];
        require(cert.exists, "CertificateEmitter: tipo de certificado inexistente");
        require(!hasClaimed[msg.sender][certTypeId], "CertificateEmitter: certificado ja reivindicado");

        for (uint256 i = 0; i < cert.requiredSkills.length; i++) {
            require(
                skillToken.hasSkill(msg.sender, cert.requiredSkills[i]),
                "CertificateEmitter: requisito de skill nao cumprido"
            );
        }

        tokenId = ++_nextTokenId;
        _safeMint(msg.sender, tokenId);
        hasClaimed[msg.sender][certTypeId] = true;
        studentTokenId[msg.sender][certTypeId] = tokenId;
        _tokenToCertType[tokenId] = certTypeId;

        emit CertificateClaimed(msg.sender, certTypeId, tokenId);
        emit Issued(owner(), msg.sender, tokenId, BurnAuth.IssuerOnly);
    }

    /// @notice Skills exigidas por um tipo de certificado.
    /// O getter automático do mapping `certificateTypes` omite membros array
    /// (limitação do compilador), então este accessor expõe a lista completa.
    function getRequiredSkills(uint256 certTypeId)
        external
        view
        returns (bytes32[] memory)
    {
        return certificateTypes[certTypeId].requiredSkills;
    }

    /// @notice Lista quais skills um aluno ainda precisa para um certificado.
    function missingSkills(address student, uint256 certTypeId)
        external
        view
        returns (bytes32[] memory missing)
    {
        CertificateType memory cert = certificateTypes[certTypeId];
        require(cert.exists, "CertificateEmitter: tipo de certificado inexistente");

        bytes32[] memory temp = new bytes32[](cert.requiredSkills.length);
        uint256 count;
        for (uint256 i = 0; i < cert.requiredSkills.length; i++) {
            if (!skillToken.hasSkill(student, cert.requiredSkills[i])) {
                temp[count++] = cert.requiredSkills[i];
            }
        }

        missing = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            missing[i] = temp[i];
        }
    }

    /// @notice Só o owner (emissor) pode revogar um certificado já emitido.
    function revokeCertificate(uint256 tokenId) external onlyOwner {
        address student = ownerOf(tokenId);
        uint256 certTypeIdFound = _tokenToCertType[tokenId];

        _burn(tokenId);
        delete _tokenToCertType[tokenId];

        if (certTypeIdFound != 0) {
            hasClaimed[student][certTypeIdFound] = false;
            delete studentTokenId[student][certTypeIdFound];
            emit CertificateRevoked(student, certTypeIdFound, tokenId);
        }
    }

    /// @notice Instituição (owner) remove um tipo de certificado.
    function deleteCertificateType(uint256 certTypeId) external onlyOwner {
        require(certificateTypes[certTypeId].exists, "CertificateEmitter: tipo inexistente");
        certificateTypes[certTypeId].exists = false;
    }

    /// @notice Retorna o próximo ID que será atribuído (total de tipos já criados).
    function nextCertTypeId() external view returns (uint256) {
        return _nextCertTypeId;
    }

    /// @notice Retorna todos os IDs de tipos de certificado já criados.
    function getCertTypeIds() external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](_nextCertTypeId);
        for (uint256 i = 0; i < _nextCertTypeId; i++) {
            ids[i] = i + 1;
        }
        return ids;
    }

    function burnAuth(uint256 /*tokenId*/) external pure override returns (BurnAuth) {
        return BurnAuth.IssuerOnly;
    }

    /// @dev Certificado final também é intransferível.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "CertificateEmitter: token intransferivel");
        return super._update(to, tokenId, auth);
    }
}
