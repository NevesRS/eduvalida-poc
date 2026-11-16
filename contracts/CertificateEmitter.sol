// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
 * @notice PROVA DE CONCEITO — certificado final como SBT consensual (EIP-5484).
 *         Fluxo 1:1 aplicado: a EMISSÃO é feita pela instituição (wallet autenticada),
 *         mas só acontece com o CONSENTIMENTO do aluno — ambos concordam.
 *         A assinatura de consentimento do aluno é validada on-chain via ecrecover.
 *         Quem pode REVOGAR é definido pelo BurnAuth do tipo de certificado.
 */
contract CertificateEmitter is ERC721, IERC5484, Ownable {
    SkillToken public immutable skillToken;

    string public constant CONSENT_PREFIX = "EduValidaConsent:";

    struct CertificateType {
        string name;
        bytes32[] requiredSkills;
        BurnAuth burnAuth;
        bool exists;
    }

    mapping(uint256 => CertificateType) public certificateTypes;
    mapping(uint256 => string) public certificateBadgeURI;
    mapping(uint256 => BurnAuth) private _tokenBurnAuth;
    mapping(uint256 => address) public tokenIssuer;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(address => mapping(uint256 => uint256)) public studentTokenId;
    mapping(uint256 => uint256) private _tokenToCertType;
    mapping(uint256 => address[]) private _requiredSigners;
    uint256 private _nextCertTypeId;
    uint256 private _nextTokenId;

    event CertificateTypeCreated(uint256 indexed certTypeId, string name);
    event CertificateIssued(address indexed issuer, address indexed student, uint256 indexed certTypeId, uint256 tokenId, BurnAuth burnAuth);
    event CertificateRevoked(address indexed student, uint256 indexed certTypeId, uint256 tokenId);
    event CertificateBadgeURISet(uint256 indexed certTypeId, string uri);
    event RequiredSignersSet(uint256 indexed certTypeId, address[] signers);

    constructor(address skillTokenAddress) ERC721("Certificado", "CERT") Ownable(msg.sender) {
        skillToken = SkillToken(skillTokenAddress);
    }

    /// @notice Instituição (owner) define um tipo de certificado: skills exigidas + BurnAuth.
    function createCertificateType(string calldata name, bytes32[] calldata requiredSkills, BurnAuth burnAuth)
        external
        onlyOwner
        returns (uint256 certTypeId)
    {
        require(requiredSkills.length > 0, "CertificateEmitter: defina ao menos 1 skill");

        certTypeId = ++_nextCertTypeId;
        certificateTypes[certTypeId] = CertificateType({
            name: name,
            requiredSkills: requiredSkills,
            burnAuth: burnAuth,
            exists: true
        });

        emit CertificateTypeCreated(certTypeId, name);
    }

    /// @notice Instituição emite o certificado AO aluno — exige consentimento assinado pelo aluno.
    function issueCertificate(uint256 certTypeId, address student, bytes calldata consentSignature)
        external
        returns (uint256 tokenId)
    {
        CertificateType memory cert = certificateTypes[certTypeId];
        require(cert.exists, "CertificateEmitter: tipo de certificado inexistente");
        require(skillToken.authorizedIssuers(msg.sender), "CertificateEmitter: emissor nao autorizado");
        require(!hasClaimed[student][certTypeId], "CertificateEmitter: certificado ja emitido");

        // Consenso (EIP-5484): o aluno assinou o consentimento de receber este certificado desta instituição
        require(
            _validateConsent(certTypeId, student, msg.sender, consentSignature),
            "CertificateEmitter: consentimento invalido"
        );

        // verifica skills (threshold de assinaturas)
        for (uint256 i = 0; i < cert.requiredSkills.length; i++) {
            require(
                skillToken.hasSkill(student, cert.requiredSkills[i]),
                "CertificateEmitter: requisito de skill nao cumprido"
            );
        }

        // verifica signatários obrigatórios
        require(allSignersSigned(student, certTypeId), "CertificateEmitter: signatarios pendentes");

        tokenId = ++_nextTokenId;
        _tokenBurnAuth[tokenId] = cert.burnAuth;
        tokenIssuer[tokenId] = msg.sender;
        _safeMint(student, tokenId);
        hasClaimed[student][certTypeId] = true;
        studentTokenId[student][certTypeId] = tokenId;
        _tokenToCertType[tokenId] = certTypeId;

        emit CertificateIssued(msg.sender, student, certTypeId, tokenId, cert.burnAuth);
        emit Issued(msg.sender, student, tokenId, cert.burnAuth);
    }

    /// @notice Valida a assinatura EIP-191 do consentimento: deve ser do próprio aluno.
    function _validateConsent(uint256 certTypeId, address student, address issuer, bytes calldata consentSignature)
        internal
        pure
        returns (bool)
    {
        if (consentSignature.length != 65) return false;

        bytes32 messageHash = keccak256(
            abi.encodePacked(CONSENT_PREFIX, certTypeId, student, issuer)
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(consentSignature.offset)
            s := calldataload(add(consentSignature.offset, 32))
            v := byte(0, calldataload(add(consentSignature.offset, 64)))
        }
        if (v < 27) v += 27;

        return ecrecover(ethSignedHash, v, r, s) == student;
    }

    /// @notice EIP-5484: BurnAuth efetivo do token.
    function burnAuth(uint256 tokenId) external view returns (BurnAuth) {
        require(_ownerOf(tokenId) != address(0), "CertificateEmitter: token inexistente");
        return _tokenBurnAuth[tokenId];
    }

    /// @notice Revogação guiada pelo BurnAuth do token.
    function revokeCertificate(uint256 tokenId) external {
        require(_ownerOf(tokenId) != address(0), "CertificateEmitter: token inexistente");

        BurnAuth auth = _tokenBurnAuth[tokenId];
        address student = ownerOf(tokenId);
        address issuer = tokenIssuer[tokenId];

        bool canBurn = auth == BurnAuth.Both
            ? (msg.sender == student || msg.sender == issuer)
            : auth == BurnAuth.IssuerOnly
                ? msg.sender == issuer
                : auth == BurnAuth.OwnerOnly
                    ? msg.sender == student
                    : false;
        require(canBurn, "CertificateEmitter: burnAuth nao permite revogacao");

        uint256 certTypeIdFound = _tokenToCertType[tokenId];
        _burn(tokenId);
        delete _tokenToCertType[tokenId];

        if (certTypeIdFound != 0) {
            hasClaimed[student][certTypeIdFound] = false;
            delete studentTokenId[student][certTypeIdFound];
            emit CertificateRevoked(student, certTypeIdFound, tokenId);
        }
    }

    /// @notice Owner define quais instituições devem assinar para um certificado.
    function setRequiredSigners(uint256 certTypeId, address[] calldata signers) external onlyOwner {
        require(certificateTypes[certTypeId].exists, "CertificateEmitter: tipo de certificado inexistente");
        _requiredSigners[certTypeId] = signers;
        emit RequiredSignersSet(certTypeId, signers);
    }

    /// @notice Retorna a lista de signatários exigidos para um certificado.
    function getRequiredSigners(uint256 certTypeId) external view returns (address[] memory) {
        return _requiredSigners[certTypeId];
    }

    /// @notice Verifica se todos os signatários emitiram todas as skills exigidas para o student.
    function allSignersSigned(address student, uint256 certTypeId) public view returns (bool) {
        CertificateType memory cert = certificateTypes[certTypeId];
        address[] memory signers = _requiredSigners[certTypeId];

        if (signers.length == 0) return true;

        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = 0; j < cert.requiredSkills.length; j++) {
                if (!skillToken.hasSkillFrom(signers[i], student, cert.requiredSkills[j])) {
                    return false;
                }
            }
        }
        return true;
    }

    /// @notice Retorna os signatários que ainda NÃO emitiram todas as skills exigidas.
    function missingSigners(address student, uint256 certTypeId)
        external
        view
        returns (address[] memory missing)
    {
        CertificateType memory cert = certificateTypes[certTypeId];
        address[] memory signers = _requiredSigners[certTypeId];

        if (signers.length == 0) return new address[](0);

        address[] memory temp = new address[](signers.length);
        uint256 count;
        for (uint256 i = 0; i < signers.length; i++) {
            bool signed = true;
            for (uint256 j = 0; j < cert.requiredSkills.length; j++) {
                if (!skillToken.hasSkillFrom(signers[i], student, cert.requiredSkills[j])) {
                    signed = false;
                    break;
                }
            }
            if (!signed) {
                temp[count++] = signers[i];
            }
        }

        missing = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            missing[i] = temp[i];
        }
    }

    /// @notice Define a URI do Open Badge associada a um tipo de certificado.
    function setCertificateBadgeURI(uint256 certTypeId, string calldata uri) external onlyOwner {
        require(certificateTypes[certTypeId].exists, "CertificateEmitter: tipo de certificado inexistente");
        certificateBadgeURI[certTypeId] = uri;
        emit CertificateBadgeURISet(certTypeId, uri);
    }

    /// @notice Skills exigidas por um tipo de certificado.
    function getRequiredSkills(uint256 certTypeId) external view returns (bytes32[] memory) {
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
