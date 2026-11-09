// API de integração (/api/integracao/*) — usada pela jornada de contratação (PWA)
// para criar o acesso do cliente, registrar contratos e atualizar o andamento das solicitações.
// Autenticação: cabeçalho "x-api-key" igual a INTEGRACAO_API_KEY.
const express = require('express');
const db = require('../lib/db');
const seg = require('../lib/seguranca');
const ops = require('../lib/operacoes');

const router = express.Router();
const falha = (res, status, mensagem) => res.status(status).json({ error: mensagem });

router.use((req, res, next) => {
    const chave = process.env.INTEGRACAO_API_KEY;
    if (!chave || !seg.chavesIguais(req.headers['x-api-key'], chave)) return falha(res, 401, 'Chave de integração inválida.');
    next();
});

async function clientePorCpf(cpf) {
    const { data, error } = await db.from('clientes').select('id').eq('cpf', cpf).maybeSingle();
    if (error) throw error;
    return data;
}

// Cria ou atualiza o cliente. A senha é a que ele criou na jornada.
router.post('/clientes', async (req, res, next) => {
    try {
        const { nome, email, telefone, senha } = req.body || {};
        const cpf = seg.limparCpf(req.body?.cpf);
        if (!seg.cpfValido(cpf)) return falha(res, 400, 'CPF inválido.');
        if (senha != null && !seg.senhaForte(senha)) return falha(res, 400, 'Senha fraca: mínimo 8 caracteres, com letras e números.');

        const existente = await clientePorCpf(cpf);
        if (!existente && !String(nome || '').trim()) return falha(res, 400, 'Nome obrigatório para novo cliente.');

        const dados = { updated_at: new Date().toISOString() };
        if (nome) dados.nome = String(nome).trim().slice(0, 150);
        if (email !== undefined) dados.email = email ? String(email).trim().slice(0, 200) : null;
        if (telefone !== undefined) dados.telefone = telefone ? String(telefone).replace(/\D/g, '').slice(0, 13) : null;
        if (senha) dados.senha_hash = await seg.gerarHashSenha(senha);

        const consulta = existente
            ? db.from('clientes').update(dados).eq('id', existente.id)
            : db.from('clientes').insert({ cpf, ...dados });
        const { data, error } = await consulta.select('id, cpf, nome').single();
        if (error) throw error;
        res.status(existente ? 200 : 201).json({ ...data, cpf: seg.mascararCpf(data.cpf), criado: !existente });
    } catch (erro) {
        next(erro);
    }
});

const CAMPOS_CONTRATO = ['numero', 'produto', 'convenio', 'banco', 'valor_liberado', 'valor_parcela', 'taxa_mensal',
    'cet_anual', 'prazo', 'parcelas_pagas', 'data_contratacao', 'primeiro_vencimento', 'status', 'documento_path'];

// Cria ou atualiza um contrato (pelo número)
router.post('/contratos', async (req, res, next) => {
    try {
        const cpf = seg.limparCpf(req.body?.cpf);
        const cliente = seg.cpfValido(cpf) && await clientePorCpf(cpf);
        if (!cliente) return falha(res, 404, 'Cliente não encontrado para este CPF.');
        if (!req.body?.numero) return falha(res, 400, 'Número do contrato obrigatório.');

        const contrato = { cliente_id: cliente.id };
        for (const campo of CAMPOS_CONTRATO) if (req.body[campo] !== undefined) contrato[campo] = req.body[campo];

        const { data, error } = await db.from('contratos')
            .upsert(contrato, { onConflict: 'numero' }).select('*').single();
        if (error) return falha(res, 400, `Contrato inválido: ${error.message}`);
        res.json(ops.detalharContrato(data));
    } catch (erro) {
        next(erro);
    }
});

// Registra uma solicitação vinda da jornada (ex.: proposta enviada pelo PWA)
router.post('/solicitacoes', async (req, res, next) => {
    try {
        const cpf = seg.limparCpf(req.body?.cpf);
        const cliente = seg.cpfValido(cpf) && await clientePorCpf(cpf);
        if (!cliente) return falha(res, 404, 'Cliente não encontrado para este CPF.');
        const { tipo = 'nova_proposta', valor_desejado = null, prazo_desejado = null, observacao = null, status = 'recebida', mensagem = null } = req.body;
        if (!ops.TIPOS_SOLICITACAO[tipo]) return falha(res, 400, 'Tipo inválido.');
        if (!ops.STATUS_SOLICITACAO[status]) return falha(res, 400, 'Status inválido.');

        let contratoId = null;
        if (req.body.contrato_numero) {
            const { data } = await db.from('contratos').select('id')
                .eq('numero', req.body.contrato_numero).eq('cliente_id', cliente.id).maybeSingle();
            if (!data) return falha(res, 404, 'Contrato não encontrado para este cliente.');
            contratoId = data.id;
        }

        let criada;
        for (let tentativa = 0; tentativa < 3 && !criada; tentativa++) {
            const { data, error } = await db.from('solicitacoes').insert({
                protocolo: ops.gerarProtocolo(), cliente_id: cliente.id, contrato_id: contratoId,
                tipo, valor_desejado, prazo_desejado, observacao, status, mensagem,
            }).select('*').single();
            if (error && error.code !== '23505') return falha(res, 400, `Solicitação inválida: ${error.message}`);
            criada = data;
        }
        if (!criada) throw new Error('Não foi possível gerar o protocolo');
        await db.from('solicitacao_eventos').insert({
            solicitacao_id: criada.id, status, descricao: mensagem || 'Solicitação registrada pela jornada de contratação.',
        });
        res.status(201).json({ protocolo: criada.protocolo, id: criada.id, status: criada.status });
    } catch (erro) {
        next(erro);
    }
});

// Atualiza o andamento (aparece na linha do tempo do cliente)
router.patch('/solicitacoes/:protocolo', async (req, res, next) => {
    try {
        const { status, mensagem } = req.body || {};
        if (!ops.STATUS_SOLICITACAO[status]) return falha(res, 400, 'Status inválido.');
        const { data: s, error } = await db.from('solicitacoes')
            .select('id').eq('protocolo', req.params.protocolo).maybeSingle();
        if (error) throw error;
        if (!s) return falha(res, 404, 'Protocolo não encontrado.');

        const texto = mensagem ? String(mensagem).slice(0, 1000) : null;
        const { error: erroUpd } = await db.from('solicitacoes')
            .update({ status, mensagem: texto, updated_at: new Date().toISOString() }).eq('id', s.id);
        if (erroUpd) throw erroUpd;
        await db.from('solicitacao_eventos').insert({ solicitacao_id: s.id, status, descricao: texto });
        res.json({ ok: true, protocolo: req.params.protocolo, status });
    } catch (erro) {
        next(erro);
    }
});

module.exports = router;
