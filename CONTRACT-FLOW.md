# EduValida POC — Fluxo dos Contratos

## Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                     Hyperledger Besu                         │
│                      (rede local)                            │
│                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐   │
│  │     SkillToken        │   │    CertificateEmitter     │   │
│  │     (ERC-1155)        │◄──│       (ERC-721)           │   │
│  │                       │   │                           │   │
│  │  Skills como saldo    │   │  Certificado final        │   │
│  │  soulbound, com       │   │  soulbound (EIP-5484)     │   │
│  │  THRESHOLD de assinat.│   │  com SIGNATÁRIOS          │   │
│  └──────────┬────────────┘   └─────────────┬─────────────┘   │
│             │                              │                 │
│             └──────────────────────────────┘                 │
│         ◄── hasSkill() verifica threshold + signers          │
└─────────────────────────────────────────────────────────────┘
```

## Ator e Contas

| Papel | Endereço | Permissões no SkillToken | Permissões no CertificateEmitter |
|-------|----------|--------------------------|----------------------------------|
| **Deployer** (owner) | `0xFE3B557...` | `createSkill`, `setIssuer`, `setSkillName`, `setSkillBadgeURI`, `setSkillThreshold` | — (transfere ownership) |
| **Instituição 1** | `0x6273060...` | `issueSkill`, `revoke` | `createCertificateType`, `revokeCertificate`, `deleteCertificateType`, `setCertificateBadgeURI`, `setRequiredSigners` |
| **Instituição 2** | `0x14dC799...` | `issueSkill`, `revoke` | — |
| **Aluno** | `0xf17f521...` | — (recebe skills) | `claimCertificate` (reivindica) |

> Na POC, a Instituição 1 é o **owner** do CertificateEmitter (ownership transferido no deploy). Ambas as instituições são **authorizedIssuers** no SkillToken.

---

## Multi-Assinatura

### Skills — Threshold Global

Uma skill só é considerada **"obtida"** quando pelo menos `skillThreshold` instituições diferentes a emitiram para o aluno.

```
setSkillThreshold(2)                          skillThreshold = 2
    │
    │  issueSkill(aluno, X) pela Inst_A       count = 1/2 (não possui)
    │  issueSkill(aluno, X) pela Inst_B       count = 2/2 (possui ✓)
    │
    │  revoke(X, Inst_A)                      count = 1/2 (não possui mais)
```

**Funções relevantes:**

| Função | Descrição |
|--------|-----------|
| `setSkillThreshold(uint256)` | Owner define o mínimo (default: 1) |
| `skillAttestationCount(holder, skillType)` | Conta quantas instituições emitiram |
| `hasSkillFrom(issuer, holder, skillType)` | Verifica se uma instituição específica emitiu |
| `hasSkill(holder, skillType)` | Retorna `true` se count ≥ threshold |

### Certificados — Lista de Signatários

Cada tipo de certificado pode exigir que **instituições específicas** tenham emitido as skills requeridas.

```
setRequiredSigners(certTypeId, [Inst_A, Inst_B])
    │
    │  allSignersSigned(aluno, certTypeId)
    │    ├── Inst_A emitiu skill X para aluno?  ✓
    │    └── Inst_B emitiu skill X para aluno?  ✗ → false
    │
    │  missingSigners(aluno, certTypeId)
    │    └── retorna [Inst_B]
```

**Funções relevantes:**

| Função | Descrição |
|--------|-----------|
| `setRequiredSigners(certTypeId, signers[])` | Owner define quais instituições devem assinar |
| `getRequiredSigners(certTypeId)` | Retorna lista de signatários exigidos |
| `allSignersSigned(student, certTypeId)` | Verifica se TODOS assinaram |
| `missingSigners(student, certTypeId)` | Retorna signatários pendentes |

---

## Fluxo Completo (Multi-Sig)

```
DEPLOYER            INST_1           INST_2            ALUNO              CONTRATOS
   │                   │                │                │                   │
   │ setSkillThreshold(2)              │                │                   │
   │──────────────────────────────────────────────────────────────────────────►│
   │                   │                │                │                   │
   │ setIssuer(I1), setIssuer(I2)      │                │                   │
   │──────────────────────────────────────────────────────────────────────────►│
   │                   │                │                │                   │
   │ createSkill("X")  │                │                │                   │
   │──────────────────────────────────────────────────────────────────────────►│
   │                   │                │                │                   │
   │                   │ issueSkill     │                │                   │
   │                   │ (aluno, X)     │                │                   │
   │                   │──────────────────────────────────────────────────────►│
   │                   │                │                │ count = 1/2       │
   │                   │                │                │                   │
   │                   │                │ issueSkill     │                   │
   │                   │                │ (aluno, X)     │                   │
   │                   │                │──────────────────────────────────────►│
   │                   │                │                │ count = 2/2 ✓     │
   │                   │                │                │                   │
   │                   │ createCertType │                │                   │
   │                   │ ("Cert", [X])  │                │                   │
   │                   │──────────────────────────────────────────────────────►│
   │                   │                │                │                   │
   │                   │ setRequiredSigners(1, [I1, I2]) │                   │
   │                   │──────────────────────────────────────────────────────►│
   │                   │                │                │                   │
   │                   │                │                │ claimCert(1)      │
   │                   │                │                │──────────────────►│
   │                   │                │                │                   │
   │                   │                │                │ hasSkill(X) = true│
   │                   │                │                │ (threshold OK)    │
   │                   │                │                │                   │
   │                   │                │                │ allSignersSigned  │
   │                   │                │                │ (I1 ✓, I2 ✓)     │
   │                   │                │                │                   │
   │                   │                │                │ → mint cert NFT   │
```

---

## Fluxo de Revogação

```
INSTITUIÇÃO                    CONTRATOS                    ALUNO
   │                              │                           │
   │  revokeCertificate(tokenId)  │                           │
   │─────────────────────────────►│                           │
   │                              │                           │
   │  1. ownerOf(tokenId) → student│                          │
   │  2. _tokenToCertType[id] → ct│                          │
   │  3. _burn(tokenId)           │                           │
   │  4. hasClaimed[std][ct]=false│                           │
   │  5. delete studentTokenId    │                           │
   │  6. emit CertificateRevoked  │                           │
   │                              │                           │
   │                              │  skillToken NÃO é afetado│
   │                              │  (skills permanecem)     │
```

---

## Fluxo de Criação de Skill

```
DEPLOYER                         CONTRATOS
   │                                 │
   │  createSkill("Solidity Basics") │
   │────────────────────────────────►│
   │                                 │
   │  skillType = keccak256(name)    │
   │  skillNames[hash] = name        │
   │  _knownSkillTypes.push(hash)    │
   │  emit SkillCreated              │
   │                                 │
```

## Fluxo de Emissão de Skill

```
INSTITUIÇÃO                      CONTRATOS
   │                                 │
   │  issueSkill(aluno, skillType)   │
   │────────────────────────────────►│
   │                                 │
   │  require: authorizedIssuers[inst] = true
   │  require: skillNames[skillType] ≠ ""
   │                                 │
   │  id = skillId(skillType, inst)  │
   │  id = keccak256(skillType, inst)│
   │                                 │
   │  _mint(aluno, id, 1, "")        │
   │  emit SkillIssued               │
   │                                 │
```

**ID da skill = `keccak256(skillType + endereço da instituição)`**

Isso permite que duas instituições atestem a mesma skill para o mesmo aluno (IDs diferentes).

---

## Fluxo de Reivindicação de Certificado

```
ALUNO                           CONTRATOS                        SkillToken
   │                                 │                              │
   │  claimCertificate(certTypeId)   │                              │
   │────────────────────────────────►│                              │
   │                                 │                              │
   │  cert = certificateTypes[id]    │                              │
   │  require(cert.exists)           │                              │
   │  require(!hasClaimed[aluno][id])│                              │
   │                                 │                              │
   │  ┌─ para cada skill required: ─┐│                              │
   │  │   skillToken.hasSkill()     ││─────────────────────────────►│
   │  │   (conta assinaturas ≥ thr.)││                              │
   │  └─────────────────────────────┘│                              │
   │                                 │                              │
   │  require(todas as skills OK)    │                              │
   │                                 │                              │
   │  ┌─ verifica signatários: ─────┐│                              │
   │  │   allSignersSigned()        ││                              │
   │  │   (cada requiredSigner      ││                              │
   │  │    emitiu cada skill?)      ││                              │
   │  └─────────────────────────────┘│                              │
   │                                 │                              │
   │  require(signers OK)            │                              │
   │                                 │                              │
   │  _safeMint(aluno, tokenId)      │                              │
   │  hasClaimed[aluno][id] = true   │                              │
   │  studentTokenId[aluno][id] = tkn│                              │
   │  _tokenToCertType[tkn] = id     │                              │
   │  emit CertificateClaimed        │                              │
```

---

## Open Badges (URI)

### SkillToken

```
setSkillBadgeURI(skillType, uri)
    │
    ├── skillBadgeURI[skillType] = uri
    └── emit SkillBadgeURISet(skillType, uri)
```

- **Quem define:** Deployer (owner)
- **Getter:** `skillBadgeURI(skillType) → string`
- **Escopo:** URI do JSON Open Badge hospedado fora da chain (IPFS, servidor, etc.)

### CertificateEmitter

```
setCertificateBadgeURI(certTypeId, uri)
    │
    ├── require(certificateTypes[certTypeId].exists)
    ├── certificateBadgeURI[certTypeId] = uri
    └── emit CertificateBadgeURISet(certTypeId, uri)
```

- **Quem define:** Instituição (owner do CertificateEmitter)
- **Getter:** `certificateBadgeURI(certTypeId) → string`
- **Validação:** Tipo de certificado deve existir

---

## Dados Armazenados On-Chain

### SkillToken

| Mapping | Tipo | Descrição |
|---------|------|-----------|
| `skillNames` | `bytes32 → string` | Nome legível de cada skill |
| `skillBadgeURI` | `bytes32 → string` | URI do Open Badge |
| `skillThreshold` | `uint256` | Mínimo de assinaturas por skill (default: 1) |
| `authorizedIssuers` | `address → bool` | Instituições autorizadas |
| `idToSkillType` | `uint256 → bytes32` | Lookup reverso: token ID → skill type |
| `idToIssuer` | `uint256 → address` | Lookup reverso: token ID → instituição |
| `_knownSkillTypes` | `bytes32[]` | Lista de todos os skill types criados |
| `_issuersList` | `address[]` | Lista de instituições (para iteração) |
| `_issuerIndex` | `address → uint256` | Índice no array (swap-and-pop) |

### CertificateEmitter

| Mapping | Tipo | Descrição |
|---------|------|-----------|
| `certificateTypes` | `uint256 → CertificateType` | Nome + skills exigidas + exists |
| `certificateBadgeURI` | `uint256 → string` | URI do Open Badge |
| `hasClaimed` | `address → uint256 → bool` | Aluno já reivindicou este tipo |
| `studentTokenId` | `address → uint256 → uint256` | Token ID do certificado do aluno |
| `_tokenToCertType` | `uint256 → uint256` | Token ID → cert type (para revogação) |
| `_requiredSigners` | `uint256 → address[]` | Instituições que devem assinar cada cert type |

---

## Restrições e Regras

### Soulbound (intransferível)

- **SkillToken (ERC-1155):** `_update` bloqueia transfers — só mint (from=0) e burn (to=0)
- **CertificateEmitter (ERC-721):** `_update` bloqueia transfers — só mint e burn
- **BurnAuth:** `IssuerOnly` — apenas a instituição pode queimar o certificado

### Controle de Acesso

| Função | Quem pode chamar |
|--------|-------------------|
| `createSkill` | Deployer (owner) |
| `setSkillName` | Deployer (owner) |
| `setSkillBadgeURI` | Deployer (owner) |
| `setSkillThreshold` | Deployer (owner) |
| `setIssuer` | Deployer (owner) |
| `issueSkill` | Instituição (authorizedIssuer) |
| `revoke` | Instituição (emissor da skill) |
| `createCertificateType` | Instituição (owner do CertificateEmitter) |
| `setRequiredSigners` | Instituição (owner) |
| `setCertificateBadgeURI` | Instituição (owner) |
| `claimCertificate` | Qualquer endereço (verifica skills + signers) |
| `revokeCertificate` | Instituição (owner) |
| `deleteCertificateType` | Instituição (owner) |

### Validações em `claimCertificate`

1. Tipo de certificado deve existir (`cert.exists = true`)
2. Aluno não pode ter já reivindicado (`hasClaimed = false`)
3. Para **cada** skill exigida: `skillToken.hasSkill(aluno, hash)` deve retornar `true` (threshold de assinaturas atingido)
4. Para **cada** signatário obrigatório: `skillToken.hasSkillFrom(signer, aluno, skill)` deve retornar `true` para todas as skills

### Validações em `revokeCertificate`

1. Token deve existir (senão `ownerOf` reverte)
2. `hasClaimed[student][certTypeId]` é resetado
3. `studentTokenId[student][certTypeId]` é deletado
4. Token é queimado via `_burn`
5. **Skills não são afetadas** — revogação do certificado não revoga as skills

---

## Endereços Deployados (Último Deploy)

```json
{
  "skillToken": "0x3Ace09BBA3b8507681146252d3Dd33cD4E2d4F63",
  "certificateEmitter": "0x3484B20600854091C166C062FacAd700123f5f71",
  "deployer": "0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73",
  "institution": "0x627306090abaB3A6e1400e9345bC60c78a8BEf57",
  "institution2": "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "student": "0xf17f52151EbEF6C7334FAD080c5704D77216b732"
}
```
