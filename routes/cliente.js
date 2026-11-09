// API da Área do Cliente (/api/cliente/*)
const express = require('express');
const db = require('../lib/db');
const seg = require('../lib/seguranca');
const ops = require('../lib/operacoes');
const assistente = require('../lib/assistente');
const { canaisAtendimento } = require('../lib/canais');

const router = express.Router();

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const CHAT_POR_DIA = 60;

const falha = (res, status, mensagem) => res.status(status).json({ error: mensagem });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pedidos que mudam algo precisam deste cabeçalho: um site de fora não consegue enviá-lo
// sem passar pelo CORS, então isso fecha a porta para CSRF junto com o SameSite do cookie.
function exigirCabecalhoApp(req, res, next) {
    if (req.method !== 'GET' && req.headers['x-antecipey'] !== '1') return falha(res, 403, 'Requisição inválida.');
    next();
}

async function exigirCliente(req, res, next) {
    try {
        const sessao = seg.lerTokenSessao(seg.lerCookie(req, seg.COOKIE_SESSAO));
        if (!sessao) return falha(res, 401, 'Sessão expirada. Entre novamente.');
        const { data: cliente, error } = await db
            .from('clientes')
            .select('id, cpf, nome, email, telefone, sessao_versao, chat_dia, chat_total')
            .eq('id', sessao.sub)
            .maybeSingle();
        if (error) throw error;
        if (!cliente || cliente.sessao_versao !== sessao.v) return falha(res, 401, 'Sessão expirada. Entre novamente.');
        req.cliente = cliente;
        next();
    } catch (erro) {
        next(erro);
    }
}

async function carregarPainel(cliente) {
    const [contratos, solicitacoes] = await Promise.all([
        db.from('contratos').select('*').eq('cliente_id', cliente.id).order('data_contratacao', { ascending: false }),
        db.from('solicitacoes')
            .select('*, solicitacao_eventos(status, descricao, created_at)')
            .eq('cliente_id', cliente.id)
            .order('created_at', { ascending: false })
            .limit(50),
    ]);
    if (contratos.error) throw contratos.error;
    if (solicitacoes.error) throw solicitacoes.error;

    const listaContratos = contratos.data.map(ops.detalharContrato);
    const ativos = listaContratos.filter((c) => c.status === 'ativo');
    return {
        cliente: {
            nome: cliente.nome,
            primeiro_nome: cliente.nome.split(' ')[0],
            cpf: seg.mascararCpf(cliente.cpf),
            email: cliente.email,
            telefone: cliente.telefone,
        },
        resumo: {
            contratos_ativos: ativos.length,
            parcela_mensal: Math.round(ativos.reduce((t, c) => t + c.valor_parcela, 0) * 100) / 100,
            saldo_estimado: Math.round(ativos.reduce((t, c) => t + c.saldo_estimado, 0) * 100) / 100,
            solicitacoes_abertas: solicitacoes.data.filter((s) => ops.STATUS_ABERTOS.includes(s.status)).length,
        },
        contratos: listaContratos,
        solicitacoes: solicitacoes.data.map(ops.detalharSolicitacao),
    };
}

router.use(exigirCabecalhoApp);

// Ids inválidos viram 404 em vez de erro do banco
router.param('id', (req, res, next, id) => (UUID.test(id) ? next() : falha(res, 404, 'Não encontrado.')));

// ── Entrar ──
router.post('/login', async (req, res, next) => {
    try {
        const cpf = seg.limparCpf(req.body?.cpf);
        const senha = String(req.body?.senha || '');
        if (!seg.cpfValido(cpf) || !senha) return falha(res, 400, 'Informe um CPF válido e a senha.');

        const { data: cliente, error } = await db
            .from('clientes')
            .select('id, senha_hash, sessao_versao, tentativas_falhas, bloqueado_ate')
            .eq('cpf', cpf)
            .maybeSingle();
        if (error) throw error;

        if (cliente?.bloqueado_ate && new Date(cliente.bloqueado_ate) > new Date()) {
            const minutos = Math.ceil((new Date(cliente.bloqueado_ate) - Date.now()) / 60000);
            return falha(res, 429, `Muitas tentativas. Tente de novo em ${minutos} min.`);
        }

        const ok = await seg.conferirSenha(senha, cliente?.senha_hash);
        if (!ok) {
            if (cliente) {
                const tentativas = cliente.tentativas_falhas + 1;
                const bloquear = tentativas >= MAX_TENTATIVAS;
                await db.from('clientes').update({
                    tentativas_falhas: bloquear ? 0 : tentativas,
                    bloqueado_ate: bloquear ? new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString() : null,
                }).eq('id', cliente.id);
                if (bloquear) return falha(res, 429, `Muitas tentativas. Tente de novo em ${BLOQUEIO_MIN} min.`);
            }
            return falha(res, 401, 'CPF ou senha incorretos.');
        }

        await db.from('clientes').update({
            tentativas_falhas: 0, bloqueado_ate: null, ultimo_acesso: new Date().toISOString(),
        }).eq('id', cliente.id);

        res.setHeader('Set-Cookie', seg.cookieSessao(req, seg.criarTokenSessao(cliente), seg.SESSAO_HORAS * 3600));
        res.json({ ok: true });
    } catch (erro) {
        next(erro);
    }
});

router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', seg.cookieSessao(req, '', 0));
    res.json({ ok: true });
});

// Canais de atendimento são públicos (aparecem também na tela de login)
router.get('/canais', (req, res) => res.json(canaisAtendimento()));

// ── Daqui para baixo, só logado ──
router.use(exigirCliente);

router.get('/painel', async (req, res, next) => {
    try {
        res.json({ ...(await carregarPainel(req.cliente)), canais: canaisAtendimento() });
    } catch (erro) {
        next(erro);
    }
});

// Nova proposta, refinanciamento, portabilidade ou pedido de atendimento
router.post('/solicitacoes', async (req, res, next) => {
    try {
        const { tipo, contrato_id, observacao } = req.body || {};
        if (!ops.TIPOS_SOLICITACAO[tipo]) return falha(res, 400, 'Tipo de solicitação inválido.');

        const valor = req.body?.valor_desejado == null || req.body.valor_desejado === '' ? null : Number(req.body.valor_desejado);
        const prazo = req.body?.prazo_desejado == null || req.body.prazo_desejado === '' ? null : Number(req.body.prazo_desejado);
        if (valor !== null && (!Number.isFinite(valor) || valor < 100 || valor > 1000000)) {
            return falha(res, 400, 'Informe um valor entre R$ 100 e R$ 1.000.000.');
        }
        if (prazo !== null && (!Number.isInteger(prazo) || prazo < 1 || prazo > 120)) {
            return falha(res, 400, 'Prazo deve ser entre 1 e 120 meses.');
        }
        const texto = observacao == null ? null : String(observacao).trim().slice(0, 1000) || null;
        if (tipo === 'atendimento' && !texto) return falha(res, 400, 'Conte rapidamente como podemos ajudar.');

        let contrato = null;
        if (tipo === 'refinanciamento' || tipo === 'portabilidade' || contrato_id) {
            if (!contrato_id) return falha(res, 400, 'Escolha o contrato.');
            if (!UUID.test(String(contrato_id))) return falha(res, 404, 'Contrato não encontrado.');
            const { data, error } = await db.from('contratos')
                .select('id, numero, status').eq('id', contrato_id).eq('cliente_id', req.cliente.id).maybeSingle();
            if (error) throw error;
            if (!data) return falha(res, 404, 'Contrato não encontrado.');
            if (data.status !== 'ativo') return falha(res, 400, 'Só é possível refinanciar contratos ativos.');
            contrato = data;

            const { count, error: erroAbertas } = await db.from('solicitacoes')
                .select('id', { count: 'exact', head: true })
                .eq('contrato_id', contrato.id).eq('tipo', tipo).in('status', ops.STATUS_ABERTOS);
            if (erroAbertas) throw erroAbertas;
            if (count > 0) return falha(res, 409, `Já existe uma solicitação de ${ops.TIPOS_SOLICITACAO[tipo].toLowerCase()} em andamento para este contrato.`);
        }

        let criada;
        for (let tentativa = 0; tentativa < 3 && !criada; tentativa++) {
            const { data, error } = await db.from('solicitacoes').insert({
                protocolo: ops.gerarProtocolo(),
                cliente_id: req.cliente.id,
                contrato_id: contrato?.id || null,
                tipo,
                valor_desejado: valor,
                prazo_desejado: prazo,
                observacao: texto,
            }).select('*').single();
            if (error && error.code !== '23505') throw error; // 23505 = protocolo repetido, tenta outro
            criada = data;
        }
        if (!criada) throw new Error('Não foi possível gerar o protocolo');

        const descricao = contrato
            ? `${ops.TIPOS_SOLICITACAO[tipo]} do contrato ${contrato.numero} recebido.`
            : `${ops.TIPOS_SOLICITACAO[tipo]} recebida.`;
        const { error: erroEvento } = await db.from('solicitacao_eventos')
            .insert({ solicitacao_id: criada.id, status: 'recebida', descricao });
        if (erroEvento) throw erroEvento;

        res.status(201).json(ops.detalharSolicitacao({
            ...criada,
            solicitacao_eventos: [{ status: 'recebida', descricao, created_at: criada.created_at }],
        }));
    } catch (erro) {
        next(erro);
    }
});

router.post('/solicitacoes/:id/cancelar', async (req, res, next) => {
    try {
        const { data: s, error } = await db.from('solicitacoes')
            .select('id, status').eq('id', req.params.id).eq('cliente_id', req.cliente.id).maybeSingle();
        if (error) throw error;
        if (!s) return falha(res, 404, 'Solicitação não encontrada.');
        if (!['recebida', 'em_analise', 'pendente'].includes(s.status)) {
            return falha(res, 400, 'Esta solicitação não pode mais ser cancelada por aqui.');
        }
        const agora = new Date().toISOString();
        const { error: erroUpd } = await db.from('solicitacoes')
            .update({ status: 'cancelada', updated_at: agora }).eq('id', s.id);
        if (erroUpd) throw erroUpd;
        await db.from('solicitacao_eventos').insert({ solicitacao_id: s.id, status: 'cancelada', descricao: 'Cancelada pelo cliente.' });
        res.json({ ok: true });
    } catch (erro) {
        next(erro);
    }
});

// Contrato em PDF: link temporário do bucket privado
router.get('/contratos/:id/documento', async (req, res, next) => {
    try {
        const { data: contrato, error } = await db.from('contratos')
            .select('documento_path').eq('id', req.params.id).eq('cliente_id', req.cliente.id).maybeSingle();
        if (error) throw error;
        if (!contrato?.documento_path) return falha(res, 404, 'Documento não disponível.');
        const { data, error: erroLink } = await db.storage.from('documentos')
            .createSignedUrl(contrato.documento_path, 120);
        if (erroLink) throw erroLink;
        res.json({ url: data.signedUrl });
    } catch (erro) {
        next(erro);
    }
});

router.put('/senha', async (req, res, next) => {
    try {
        const { senha_atual, nova_senha } = req.body || {};
        if (!seg.senhaForte(nova_senha)) return falha(res, 400, 'A nova senha precisa ter 8+ caracteres, com letras e números.');
        const { data: cliente, error } = await db.from('clientes')
            .select('id, senha_hash, sessao_versao').eq('id', req.cliente.id).single();
        if (error) throw error;
        if (!(await seg.conferirSenha(String(senha_atual || ''), cliente.senha_hash))) {
            return falha(res, 400, 'Senha atual incorreta.');
        }
        const atualizado = { ...cliente, sessao_versao: cliente.sessao_versao + 1 };
        const { error: erroUpd } = await db.from('clientes').update({
            senha_hash: await seg.gerarHashSenha(nova_senha),
            sessao_versao: atualizado.sessao_versao,
            updated_at: new Date().toISOString(),
        }).eq('id', cliente.id);
        if (erroUpd) throw erroUpd;
        // Desconecta outros aparelhos e mantém este logado
        res.setHeader('Set-Cookie', seg.cookieSessao(req, seg.criarTokenSessao(atualizado), seg.SESSAO_HORAS * 3600));
        res.json({ ok: true });
    } catch (erro) {
        next(erro);
    }
});

// ── Assistente virtual ──
router.post('/chat', async (req, res, next) => {
    try {
        const hoje = new Date().toISOString().slice(0, 10);
        const usadas = req.cliente.chat_dia === hoje ? req.cliente.chat_total : 0;
        if (usadas >= CHAT_POR_DIA) {
            return falha(res, 429, 'Você chegou ao limite de mensagens de hoje. Fale com o atendimento se precisar.');
        }
        await db.from('clientes').update({ chat_dia: hoje, chat_total: usadas + 1 }).eq('id', req.cliente.id);

        const canais = canaisAtendimento();
        const resultado = await assistente.responder({
            mensagens: req.body?.mensagens,
            painel: await carregarPainel(req.cliente),
            canais,
        });
        if (resultado.erro) return falha(res, 400, resultado.erro);
        if (resultado.indisponivel) {
            return res.json({
                texto: 'Nosso assistente está indisponível neste momento. Veja as dúvidas frequentes acima ou fale com a equipe na aba Atendimento.',
                indisponivel: true,
            });
        }
        res.json({ texto: resultado.texto });
    } catch (erro) {
        next(erro);
    }
});

module.exports = router;
