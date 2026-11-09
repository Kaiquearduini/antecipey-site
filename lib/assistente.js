// Assistente virtual da Área do Cliente (Claude, da Anthropic)
const Anthropic = require('@anthropic-ai/sdk');

const MODELO = 'claude-opus-5-5';
const MAX_MENSAGENS = 16;      // histórico enviado por pedido
const MAX_CARACTERES = 1200;   // por mensagem do cliente

let cliente;
function clienteAnthropic() {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    // Funções da Netlify param em ~10 s: sem novas tentativas e com folga
    cliente = cliente || new Anthropic({ timeout: 8500, maxRetries: 0 });
    return cliente;
}

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function resumoDoCliente(painel) {
    const linhas = [`Nome: ${painel.cliente.nome.split(' ')[0]}`];
    for (const c of painel.contratos) {
        linhas.push(
            `Contrato ${c.numero} (${c.produto}${c.convenio ? `, ${c.convenio}` : ''}) — status ${c.status}; ` +
            `liberado ${brl(c.valor_liberado)}; parcela ${brl(c.valor_parcela)}; taxa ${c.taxa_mensal}% a.m.; ` +
            `${c.parcelas_pagas} de ${c.prazo} parcelas descontadas; saldo devedor estimado ${brl(c.saldo_estimado)}` +
            (c.proximo_vencimento ? `; próximo desconto ${c.proximo_vencimento}` : '')
        );
    }
    for (const s of painel.solicitacoes) {
        linhas.push(`Solicitação ${s.protocolo}: ${s.tipo_nome} — ${s.status_nome}` +
            (s.mensagem ? ` (recado da equipe: ${s.mensagem})` : ''));
    }
    if (!painel.contratos.length && !painel.solicitacoes.length) linhas.push('Ainda não há contratos nem solicitações.');
    return linhas.join('\n');
}

function promptSistema(painel, canais) {
    const contato = [
        canais.whatsapp && `WhatsApp ${canais.whatsapp_exibicao}`,
        canais.telefone && `telefone ${canais.telefone_exibicao}`,
    ].filter(Boolean).join(' ou ') || 'a aba Atendimento da Área do Cliente';

    return `Você é a assistente virtual da Antecipey, empresa de crédito para servidores públicos e trabalhadores (consignado, antecipação, refinanciamento e portabilidade). Você conversa com um cliente já logado na Área do Cliente do site.

Como responder:
- Português do Brasil, tom cordial e direto, frases curtas. Respostas de no máximo 6 linhas, sem markdown pesado (pode usar listas simples com "-").
- Use os dados do cliente abaixo para responder sobre os contratos e solicitações dele. Não invente números, prazos, taxas ou aprovações que não estejam nos dados.
- O saldo devedor é estimado; a quitação oficial depende de cálculo da equipe.
- Você não aprova crédito, não altera contratos e não promete valores. Para simular, contratar ou refinanciar, oriente a usar os botões "Nova proposta" ou "Refinanciar" no painel.
- Se o cliente pedir para falar com uma pessoa, reclamar, ou o assunto fugir do que você sabe, indique ${contato}.
- Nunca peça senha, código, token ou dados de cartão. Se o cliente enviar algo assim, oriente a não compartilhar.
- Assuntos fora de crédito e da Antecipey: responda com educação que só pode ajudar com a conta Antecipey.

Dados do cliente (somente leitura):
${resumoDoCliente(painel)}`;
}

function normalizarHistorico(mensagens) {
    if (!Array.isArray(mensagens)) return [];
    const limpas = mensagens
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CARACTERES) }))
        .filter((m) => m.content)
        .slice(-MAX_MENSAGENS);
    while (limpas.length && limpas[0].role !== 'user') limpas.shift();
    return limpas;
}

async function responder({ mensagens, painel, canais }) {
    const anthropic = clienteAnthropic();
    if (!anthropic) return { indisponivel: true };

    const historico = normalizarHistorico(mensagens);
    if (!historico.length || historico[historico.length - 1].role !== 'user') {
        return { erro: 'Mensagem vazia.' };
    }

    try {
        const resposta = await anthropic.beta.messages.create({
            model: MODELO,
            max_tokens: 1024,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'low' },
            system: promptSistema(painel, canais),
            messages: historico,
        });

        if (resposta.stop_reason === 'refusal') {
            return { texto: 'Não consigo ajudar com esse assunto por aqui. Se precisar, fale com nosso atendimento na aba Atendimento.' };
        }
        const texto = resposta.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
        return { texto: texto || 'Desculpe, não consegui responder agora. Pode reformular a pergunta?' };
    } catch (erro) {
        if (erro instanceof Anthropic.RateLimitError) {
            console.warn('[assistente] limite de uso da Anthropic');
        } else if (erro instanceof Anthropic.APIConnectionTimeoutError) {
            console.warn('[assistente] tempo esgotado');
        } else if (erro instanceof Anthropic.APIError) {
            console.error(`[assistente] erro ${erro.status}: ${erro.message}`);
        } else {
            console.error('[assistente]', erro);
        }
        return { indisponivel: true };
    }
}

module.exports = { responder, normalizarHistorico };
