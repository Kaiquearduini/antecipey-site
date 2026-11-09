// Regras de contratos e solicitações (cálculos e textos mostrados ao cliente)
const crypto = require('crypto');

const STATUS_SOLICITACAO = {
    recebida:   'Recebida',
    em_analise: 'Em análise',
    pendente:   'Pendente de documentos',
    aprovada:   'Aprovada',
    reprovada:  'Não aprovada',
    paga:       'Valor liberado',
    cancelada:  'Cancelada',
};

const TIPOS_SOLICITACAO = {
    nova_proposta:   'Nova proposta',
    refinanciamento: 'Refinanciamento',
    portabilidade:   'Portabilidade',
    atendimento:     'Atendimento',
};

const STATUS_ABERTOS = ['recebida', 'em_analise', 'pendente', 'aprovada'];

// Protocolo legível: ANT-AAMMDD-XXXXX (sem letras ambíguas)
function gerarProtocolo(data = new Date()) {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(5);
    const sufixo = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
    const ymd = data.toISOString().slice(2, 10).replace(/-/g, '');
    return `ANT-${ymd}-${sufixo}`;
}

// Saldo devedor estimado: valor presente das parcelas que faltam, à taxa do contrato
function saldoDevedorEstimado(contrato) {
    const restantes = Math.max(0, contrato.prazo - contrato.parcelas_pagas);
    if (contrato.status !== 'ativo' || restantes === 0) return 0;
    const i = Number(contrato.taxa_mensal) / 100;
    const parcela = Number(contrato.valor_parcela);
    const saldo = i > 0 ? parcela * (1 - Math.pow(1 + i, -restantes)) / i : parcela * restantes;
    return Math.round(saldo * 100) / 100;
}

function proximoVencimento(contrato, hoje = new Date()) {
    if (contrato.status !== 'ativo' || !contrato.primeiro_vencimento) return null;
    if (contrato.parcelas_pagas >= contrato.prazo) return null;
    const base = new Date(`${contrato.primeiro_vencimento}T12:00:00Z`);
    const mesesDepois = (n) => {
        const d = new Date(base);
        d.setUTCMonth(base.getUTCMonth() + n);
        return d;
    };
    // Se a baixa da última parcela ainda não foi registrada, pula para o próximo vencimento futuro
    let n = contrato.parcelas_pagas;
    while (n < contrato.prazo && mesesDepois(n) < hoje) n++;
    return n < contrato.prazo ? mesesDepois(n).toISOString().slice(0, 10) : null;
}

function detalharContrato(contrato) {
    const { documento_path, cliente_id, ...publico } = contrato;
    return {
        ...publico,
        valor_liberado: Number(contrato.valor_liberado),
        valor_parcela: Number(contrato.valor_parcela),
        taxa_mensal: Number(contrato.taxa_mensal),
        cet_anual: contrato.cet_anual == null ? null : Number(contrato.cet_anual),
        parcelas_restantes: Math.max(0, contrato.prazo - contrato.parcelas_pagas),
        progresso: Math.round((contrato.parcelas_pagas / contrato.prazo) * 100),
        saldo_estimado: saldoDevedorEstimado(contrato),
        proximo_vencimento: proximoVencimento(contrato),
        tem_documento: Boolean(documento_path),
    };
}

function detalharSolicitacao(s) {
    const { cliente_id, ...publico } = s;
    return {
        ...publico,
        valor_desejado: s.valor_desejado == null ? null : Number(s.valor_desejado),
        tipo_nome: TIPOS_SOLICITACAO[s.tipo] || s.tipo,
        status_nome: STATUS_SOLICITACAO[s.status] || s.status,
        aberta: STATUS_ABERTOS.includes(s.status),
        eventos: (s.solicitacao_eventos || [])
            .slice()
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .map(({ status, descricao, created_at }) => ({
                status, descricao, created_at, status_nome: STATUS_SOLICITACAO[status] || status,
            })),
        solicitacao_eventos: undefined,
    };
}

module.exports = {
    STATUS_SOLICITACAO, TIPOS_SOLICITACAO, STATUS_ABERTOS,
    gerarProtocolo, saldoDevedorEstimado, proximoVencimento,
    detalharContrato, detalharSolicitacao,
};
