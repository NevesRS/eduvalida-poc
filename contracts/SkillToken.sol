// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SkillToken
 * @notice PROVA DE CONCEITO — mini-certificações (skills) como saldo ERC-1155,
 *         permanentes, intransferíveis e reutilizáveis em múltiplos certificados.
 *         Cada instituição emite sob seu próprio "namespace" de id (hash de
 *         skillType + endereço da instituição), permitindo revogação isolada por
 *         emissor mesmo quando duas instituições atestam a mesma competência
 *         para o mesmo aluno.
 *
 *         Multi-assinatura: `skillThreshold` define quantas instituições
 *         diferentes precisam emitir uma skill para que o aluno seja
 *         considerado como a tendo obtido.
 */
contract SkillToken is ERC1155, Ownable {
    mapping(address => bool) public authorizedIssuers;
    address[] private _issuersList;
    mapping(address => uint256) private _issuerIndex;
    bytes32[] private _knownSkillTypes;

    mapping(bytes32 => string) public skillNames;
    mapping(bytes32 => string) public skillBadgeURI;
    mapping(uint256 => bytes32) public idToSkillType;
    mapping(uint256 => address) public idToIssuer;

    uint256 public skillThreshold = 1;

    event SkillCreated(bytes32 indexed skillType, string name);
    event SkillIssued(address indexed institution, address indexed to, bytes32 indexed skillType, uint256 id);
    event SkillRevoked(address indexed institution, address indexed from, bytes32 indexed skillType, uint256 id);
    event SkillBadgeURISet(bytes32 indexed skillType, string uri);
    event SkillThresholdUpdated(uint256 newThreshold);

    constructor() ERC1155("") Ownable(msg.sender) {}

    /// @notice Define o número mínimo de instituições que devem atestar uma skill.
    function setSkillThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "SkillToken: threshold deve ser > 0");
        skillThreshold = _threshold;
        emit SkillThresholdUpdated(_threshold);
    }

    /// @notice Credencia (ou descredencia) uma instituição como emissora.
    function setIssuer(address institution, bool status) external onlyOwner {
        if (status && !authorizedIssuers[institution]) {
            _issuerIndex[institution] = _issuersList.length;
            _issuersList.push(institution);
        } else if (!status && authorizedIssuers[institution]) {
            uint256 idx = _issuerIndex[institution];
            uint256 last = _issuersList.length - 1;
            if (idx != last) {
                address tail = _issuersList[last];
                _issuersList[idx] = tail;
                _issuerIndex[tail] = idx;
            }
            _issuersList.pop();
            delete _issuerIndex[institution];
        }
        authorizedIssuers[institution] = status;
    }

    /// @notice Define (ou corrige) o nome legível de um skillType.
    function setSkillName(bytes32 skillType, string calldata name) external onlyOwner {
        skillNames[skillType] = name;
    }

    /// @notice Define a URI do Open Badge associada a um skillType.
    function setSkillBadgeURI(bytes32 skillType, string calldata uri) external onlyOwner {
        skillBadgeURI[skillType] = uri;
        emit SkillBadgeURISet(skillType, uri);
    }

    /// @notice Instituição cria um novo tipo de skill (apenas registra o nome).
    function createSkill(string calldata name) external onlyOwner returns (bytes32 skillType) {
        skillType = keccak256(abi.encodePacked(name));
        require(bytes(skillNames[skillType]).length == 0, "SkillToken: skill already exists");

        skillNames[skillType] = name;
        _knownSkillTypes.push(skillType);

        emit SkillCreated(skillType, name);
    }

    /// @notice Calcula o id ERC-1155 a partir do skillType + instituição emissora.
    function skillId(bytes32 skillType, address institution) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(skillType, institution)));
    }

    /// @notice Instituição emite (cunha) uma unidade da skill para o aluno.
    function issueSkill(address to, bytes32 skillType) external returns (uint256 id) {
        require(authorizedIssuers[msg.sender], "SkillToken: emissor nao autorizado");
        require(bytes(skillNames[skillType]).length > 0, "SkillToken: skill not created");

        id = skillId(skillType, msg.sender);
        idToSkillType[id] = skillType;
        idToIssuer[id] = msg.sender;

        _mint(to, id, 1, "");
        emit SkillIssued(msg.sender, to, skillType, id);
    }

    /// @notice Só a instituição emissora pode revogar (queimar) a unidade que ela cunhou.
    function revoke(address from, bytes32 skillType) external {
        uint256 id = skillId(skillType, msg.sender);
        require(balanceOf(from, id) > 0, "SkillToken: aluno nao possui essa skill");

        _burn(from, id, 1);
        emit SkillRevoked(msg.sender, from, skillType, id);
    }

    /// @notice Conta quantas instituições emitiram a skill para o holder.
    function skillAttestationCount(address holder, bytes32 skillType) external view returns (uint256 count) {
        for (uint256 i = 0; i < _issuersList.length; i++) {
            uint256 id = skillId(skillType, _issuersList[i]);
            if (balanceOf(holder, id) > 0) {
                count++;
            }
        }
    }

    /// @notice Verifica se uma instituição específica emitiu a skill para o holder.
    function hasSkillFrom(address issuer, address holder, bytes32 skillType) external view returns (bool) {
        uint256 id = skillId(skillType, issuer);
        return balanceOf(holder, id) > 0;
    }

    /// @notice Verifica se `holder` possui a skill informada (threshold de assinaturas atingido).
    function hasSkill(address holder, bytes32 skillType) external view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < _issuersList.length; i++) {
            uint256 id = skillId(skillType, _issuersList[i]);
            if (balanceOf(holder, id) > 0) {
                count++;
                if (count >= skillThreshold) return true;
            }
        }
        return false;
    }

    /// @notice Retorna todos os skillTypes que já foram emitidos.
    function getKnownSkillTypes() external view returns (bytes32[] memory) {
        return _knownSkillTypes;
    }

    /// @notice Retorna a lista de instituições autorizadas.
    function getIssuersList() external view returns (address[] memory) {
        return _issuersList;
    }

    /// @dev Bloqueia qualquer transferência entre contas — saldo soulbound.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
    {
        require(from == address(0) || to == address(0), "SkillToken: saldo intransferivel");
        super._update(from, to, ids, values);
    }
}
