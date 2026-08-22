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
 *         Simplificações assumidas nesta versão (a substituir por um time
 *         especializado numa v2):
 *          - `authorizedIssuers` faz o papel do TrustRegistry, controlado pelo
 *            owner do contrato em vez de aprovação por quórum de instituições.
 *          - Não existe SkillTaxonomyRegistry: `skillType` é um bytes32 livre
 *            (ex: keccak256("CRIPTOGRAFIA_BASICA")), sem validação de vocabulário
 *            nem hierarquia entre skills.
 */
contract SkillToken is ERC1155, Ownable {
    mapping(address => bool) public authorizedIssuers;
    address[] private _issuersList;
    mapping(address => uint256) private _issuerIndex;
    bytes32[] private _knownSkillTypes;

    mapping(bytes32 => string) public skillNames;
    mapping(uint256 => bytes32) public idToSkillType; // lookup reverso, útil pra UI/debug
    mapping(uint256 => address) public idToIssuer;

    event SkillCreated(bytes32 indexed skillType, string name);
    event SkillIssued(address indexed institution, address indexed to, bytes32 indexed skillType, uint256 id);
    event SkillRevoked(address indexed institution, address indexed from, bytes32 indexed skillType, uint256 id);

    constructor() ERC1155("") Ownable(msg.sender) {}

    /// @notice Credencia (ou descredencia) uma instituição como emissora.
    /// Em produção, isso seria o TrustRegistry, aprovado por quórum de instituições.
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
    /// Simplificação da demo: em produção, isso viveria no SkillTaxonomyRegistry.
    function setSkillName(bytes32 skillType, string calldata name) external onlyOwner {
        skillNames[skillType] = name;
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

    /// @notice Verifica se `holder` possui a skill informada, de qualquer instituição autorizada.
    /// Usado pelo CertificateEmitter para checar requisitos sem "gastar" nenhum saldo.
    function hasSkill(address holder, bytes32 skillType) external view returns (bool) {
        for (uint256 i = 0; i < _issuersList.length; i++) {
            uint256 id = skillId(skillType, _issuersList[i]);
            if (balanceOf(holder, id) > 0) {
                return true;
            }
        }
        return false;
    }

    /// @notice Retorna todos os skillTypes que já foram emitidos.
    function getKnownSkillTypes() external view returns (bytes32[] memory) {
        return _knownSkillTypes;
    }

    /// @dev Bloqueia qualquer transferência entre contas — saldo soulbound.
    /// Mint (from == address(0)) e burn (to == address(0)) continuam permitidos.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
    {
        require(from == address(0) || to == address(0), "SkillToken: saldo intransferivel");
        super._update(from, to, ids, values);
    }
}
