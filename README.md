# Antecipey

Site institucional da Antecipey: https://www.antecipey.com.br

## Estrutura

- `index.html`: página inicial (Tailwind via CDN, fonte Sora)
- `servicos.html` / `servico.html`: lista e detalhe dos serviços
- `admin.html`: painel para editar textos, depoimentos, FAQ e serviços
- `cliente.html`: Área do Cliente (`/cliente`)
- `server.js`: servidor Express que entrega as páginas e a API (`/api/*`), lendo e gravando no Supabase
- `routes/cliente.js`: API da Área do Cliente (`/api/cliente/*`)
- `routes/integracao.js`: API para a jornada de contratação (`/api/integracao/*`)
- `lib/`: banco, segurança (senha, sessão), regras de contratos, canais de atendimento e assistente virtual
- `netlify/functions/api.js`: roda o `server.js` como função da Netlify
- `supabase/`: SQL das tabelas (`schema.sql` e `area-cliente.sql`)
- `scripts/criar-usuario-teste.js`: cria o cliente de teste (dados em `USUARIO-TESTE.txt`, fora do Git)
- `assets/`: imagens

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha as variáveis
npm start              # http://localhost:3000
```

## Tabelas do Supabase usadas

Site: `testimonials`, `faq`, `services` e `site_content` (chave/valor dos textos do site).

Área do Cliente: `clientes`, `contratos`, `solicitacoes` e `solicitacao_eventos`, além do bucket privado `documentos` (PDF dos contratos).

## Área do Cliente

O cliente entra com CPF e senha em `/cliente` e vê:

- **Início**: total descontado por mês, saldo devedor estimado e o que está em andamento
- **Contratos**: parcelas descontadas, valor da parcela, taxa, CET, próximo desconto e o PDF do contrato
- **Acompanhar**: cada solicitação com etapas (recebida → em análise → aprovada → liberado), recados da equipe e histórico
- **Dúvidas**: perguntas frequentes e assistente virtual (Claude) que conhece os contratos do cliente
- **Atendimento**: WhatsApp, telefone, abertura de chamado e troca de senha

Botões de **Nova proposta** e **Refinanciar** criam uma solicitação com protocolo.

Segurança: senha com scrypt, sessão em cookie HttpOnly assinado (8 h), bloqueio de 15 min após 5 senhas erradas, troca de senha desconecta os outros aparelhos, documentos só por link temporário.

## Integração com a jornada (PWA)

Todas as chamadas levam o cabeçalho `x-api-key: <INTEGRACAO_API_KEY>`.

| Chamada | Para quê |
|---|---|
| `POST /api/integracao/clientes` | Cria ou atualiza o cliente. Corpo: `cpf`, `nome`, `email`, `telefone`, `senha` (a senha que o cliente criou na jornada). |
| `POST /api/integracao/contratos` | Cria ou atualiza um contrato pelo `numero`. Corpo: `cpf`, `numero`, `produto`, `convenio`, `banco`, `valor_liberado`, `valor_parcela`, `taxa_mensal`, `cet_anual`, `prazo`, `parcelas_pagas`, `data_contratacao`, `primeiro_vencimento`, `status` (`em_averbacao`, `ativo`, `quitado`, `cancelado`), `documento_path`. |
| `POST /api/integracao/solicitacoes` | Registra uma proposta e devolve o `protocolo`. Corpo: `cpf`, `tipo`, `valor_desejado`, `prazo_desejado`, `status`, `mensagem`, `contrato_numero`. |
| `PATCH /api/integracao/solicitacoes/:protocolo` | Muda o andamento. Corpo: `status` (`recebida`, `em_analise`, `pendente`, `aprovada`, `reprovada`, `paga`, `cancelada`) e `mensagem` (aparece para o cliente). |

Fluxo pensado: o cliente termina a jornada, cria a senha, a jornada chama `/clientes` e `/solicitacoes` e manda o cliente para `https://www.antecipey.com.br/cliente`.

## Variáveis de ambiente

Veja `.env.example`. Na Netlify ficam em *Project configuration → Environment variables*.
