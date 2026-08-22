# EduValida POC

Prova de conceito de um front-end que interage com dois contratos Solidity em uma rede Hyperledger Besu local.

## Pré-requisitos

- Node.js v18+
- Docker + Docker Compose (para rodar a Besu)
- Rede Besu rodando em `http://localhost:8545`

## Rodar do zero

### 1. Iniciar a rede Besu

```bash
cd /home/nevesrs/besu-test-network
docker compose up -d
```

Aguarde o rpcnode ficar healthy (verifique com `docker compose ps`).

### 2. Instalar dependências

```bash
cd /home/nevesrs/Codes/eduvalida-poc
npm install
```

### 3. Deploy dos contratos

```bash
npm run deploy
```

Isso vai:
- Deployar `SkillToken` e `CertificateEmitter` na Besu local
- Autorizar a conta de instituição como emissor
- Salvar os endereços em `deployed-addresses.json`

### 4. Rodar o front-end

```bash
npm run dev
```

Acesse `http://localhost:5173` no navegador.

## Contas de teste (genensis.json)

| Papel | Endereço | Chave Privada |
|-------|----------|---------------|
| Deployer (owner) | `0xfe3b557e8fb62b89f4916b721be55ceb828dbd73` | `0x8f2a5594...` |
| Instituição | `0x627306090abaB3A6e1400e9345bC60c78a8BEf57` | `0xc87509a1...` |
| Aluno | `0xf17f52151EbEF6C7334FAD080c5704D77216b732` | `0xae6ae8e5...` |

## Fluxo da POC

1. **Instituição** emite uma skill para o aluno
2. **Aluno** verifica que possui a skill
3. **Instituição** cria um tipo de certificado exigindo aquela skill
4. **Aluno** verifica os requisitos pendentes
5. **Aluno** reivindica o certificado (quando todos os requisitos estão cumpridos)
6. Confirma que o certificado foi emitido

## Nota sobre skill names

Os nomes das skills são convertidos para `bytes32` via `keccak256` no front-end. O registro de nomes conhecidos é mantido no cliente — quando você emite uma skill ou cria um certificado com o nome "Solidity Basics", o front-end guarda essa associação para exibição.
