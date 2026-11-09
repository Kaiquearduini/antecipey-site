// Cria (ou recria) o cliente de teste da Área do Cliente com contratos, solicitações e PDFs.
// Uso: node scripts/criar-usuario-teste.js
// O CPF e a senha ficam em USUARIO-TESTE.txt (fora do GitHub).
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const seg = require('../lib/seguranca');
const ops = require('../lib/operacoes');

const NOME = 'Cliente Teste Antecipey';
const ARQUIVO = path.join(__dirname, '..', 'USUARIO-TESTE.txt');

function gerarCpf() {
    const n = Array.from({ length: 9 }, () => crypto.randomInt(10));
    for (const tamanho of [9, 10]) {
        const soma = n.reduce((t, d, i) => t + d * (tamanho + 1 - i), 0);
        const resto = (soma * 10) % 11;
        n.push(resto === 10 ? 0 : resto);
    }
    const cpf = n.join('');
    return seg.cpfValido(cpf) ? cpf : gerarCpf();
}

function gerarSenha() {
    const letras = 'abcdefghjkmnpqrstuvwxyz';
    const parte = Array.from({ length: 6 }, () => letras[crypto.randomInt(letras.length)]).join('');
    return `Teste-${parte}${crypto.randomInt(10, 99)}`;
}

// PDF simples (uma página, Helvetica) — só para o teste do botão "Baixar contrato"
function gerarPdf(titulo, linhas) {
    const limpar = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const conteudo = [
        'BT /F2 18 Tf 56 780 Td (' + limpar(titulo) + ') Tj ET',
        'BT /F1 9 Tf 56 762 Td (DOCUMENTO DE TESTE - SEM VALOR JURIDICO) Tj ET',
        ...linhas.map((l, i) => `BT /F1 11 Tf 56 ${730 - i * 20} Td (${limpar(l)}) Tj ET`),
    ].join('\n');
    const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
        `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];
    let pdf = '%PDF-1.4\n';
    const posicoes = objetos.map((obj, i) => {
        const pos = Buffer.byteLength(pdf, 'latin1');
        pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
        return pos;
    });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    pdf += posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
}

const dataIso = (d) => d.toISOString().slice(0, 10);
const mesesAtras = (n, dia = 10) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - n);
    d.setUTCDate(dia);
    return d;
};
const diasAtras = (n, horas = 0) => new Date(Date.now() - n * 86400000 - horas * 3600000).toISOString();
// Parcela fixa (tabela Price) para os números do teste baterem entre si
const parcelaPrice = (valor, taxaMes, prazo) => {
    const i = taxaMes / 100;
    return Math.round(((valor * i) / (1 - Math.pow(1 + i, -prazo))) * 100) / 100;
};
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function principal() {
    // Remove o teste anterior (contratos e solicitações caem junto pelo "on delete cascade")
    const anterior = fs.existsSync(ARQUIVO) && /CPF:\s*([\d.-]+)/.exec(fs.readFileSync(ARQUIVO, 'utf8'));
    if (anterior) {
        const cpfAnterior = seg.limparCpf(anterior[1]);
        const { data: velho } = await db.from('clientes').select('id').eq('cpf', cpfAnterior).maybeSingle();
        if (velho) {
            const { data: docs } = await db.storage.from('documentos').list(`teste/${velho.id}`);
            if (docs?.length) await db.storage.from('documentos').remove(docs.map((d) => `teste/${velho.id}/${d.name}`));
            await db.from('clientes').delete().eq('id', velho.id);
        }
    }

    const cpf = gerarCpf();
    const senha = gerarSenha();
    const { data: cliente, error } = await db.from('clientes').insert({
        cpf, nome: NOME, email: 'cliente.teste@antecipey.com.br', telefone: '11900000000',
        senha_hash: await seg.gerarHashSenha(senha),
    }).select('id').single();
    if (error) throw error;

    const sufixo = cpf.slice(-4);
    const contratos = [
        {
            numero: `CT-${sufixo}-001`, produto: 'Crédito Consignado', convenio: 'INSS', banco: 'Banco Parceiro S.A.',
            valor_liberado: 12500, valor_parcela: parcelaPrice(12500, 1.66, 84), taxa_mensal: 1.66, cet_anual: 22.14, prazo: 84,
            parcelas_pagas: 14, data_contratacao: dataIso(mesesAtras(15, 2)), primeiro_vencimento: dataIso(mesesAtras(14, 7)), status: 'ativo',
        },
        {
            numero: `CT-${sufixo}-002`, produto: 'Consignado Servidor', convenio: 'Governo do Estado de SP', banco: 'Banco Parceiro S.A.',
            valor_liberado: 8200, valor_parcela: parcelaPrice(8200, 1.89, 60), taxa_mensal: 1.89, cet_anual: 25.6, prazo: 60,
            parcelas_pagas: 31, data_contratacao: dataIso(mesesAtras(32, 15)), primeiro_vencimento: dataIso(mesesAtras(31, 5)), status: 'ativo',
        },
        {
            numero: `CT-${sufixo}-003`, produto: 'Antecipação Saque-Aniversário FGTS', convenio: 'FGTS', banco: 'Banco Parceiro S.A.',
            valor_liberado: 2350, valor_parcela: parcelaPrice(2350, 1.79, 5), taxa_mensal: 1.79, cet_anual: 23.8, prazo: 5,
            parcelas_pagas: 5, data_contratacao: dataIso(mesesAtras(70, 20)), primeiro_vencimento: dataIso(mesesAtras(62, 1)), status: 'quitado',
        },
    ];

    const criados = [];
    for (const c of contratos) {
        const caminho = `teste/${cliente.id}/${c.numero}.pdf`;
        const pdf = gerarPdf(`Contrato ${c.numero}`, [
            `Cliente: ${NOME}`, `CPF: ${seg.mascararCpf(cpf)}`, `Produto: ${c.produto} (${c.convenio})`,
            `Valor liberado: ${brl(c.valor_liberado)}`, `Parcela: ${brl(c.valor_parcela)} x ${c.prazo}`,
            `Taxa: ${c.taxa_mensal}% a.m. | CET: ${c.cet_anual}% a.a.`, `Data da contratação: ${c.data_contratacao}`,
        ]);
        const { error: erroUp } = await db.storage.from('documentos')
            .upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
        if (erroUp) throw erroUp;
        const { data, error: erroC } = await db.from('contratos')
            .insert({ ...c, cliente_id: cliente.id, documento_path: caminho }).select('id, numero').single();
        if (erroC) throw erroC;
        criados.push(data);
    }

    const solicitacoes = [
        {
            tipo: 'nova_proposta', valor_desejado: 5000, prazo_desejado: 48, status: 'em_analise', criada: diasAtras(2, 3),
            observacao: 'Preciso para reformar a cozinha.',
            eventos: [
                ['recebida', 'Recebemos seu pedido.', diasAtras(2, 3)],
                ['em_analise', 'Estamos vendo a melhor proposta para você.', diasAtras(1, 5)],
            ],
        },
        {
            tipo: 'refinanciamento', contrato: 1, valor_desejado: 3000, status: 'pendente', criada: diasAtras(6),
            observacao: 'Liberar dinheiro novo',
            mensagem: 'Manda uma foto do seu último contracheque no WhatsApp para a gente seguir. 📄',
            eventos: [
                ['recebida', `Recebemos seu pedido de refinanciamento do contrato ${criados[1].numero}.`, diasAtras(6)],
                ['em_analise', 'Estamos simulando para você.', diasAtras(5)],
                ['pendente', 'Manda uma foto do seu último contracheque no WhatsApp para a gente seguir. 📄', diasAtras(3)],
            ],
        },
        {
            tipo: 'nova_proposta', valor_desejado: 12500, prazo_desejado: 84, status: 'paga', criada: diasAtras(460), contrato: 0,
            mensagem: 'Dinheiro na sua conta! Obrigado por escolher a Antecipey. 💚',
            eventos: [
                ['recebida', 'Recebemos seu pedido.', diasAtras(460)],
                ['em_analise', 'Estamos vendo a melhor proposta para você.', diasAtras(459)],
                ['aprovada', 'Aprovado! Contrato assinado.', diasAtras(457)],
                ['paga', 'Dinheiro na sua conta! Obrigado por escolher a Antecipey. 💚', diasAtras(455)],
            ],
        },
    ];

    for (const s of solicitacoes) {
        const { data, error: erroS } = await db.from('solicitacoes').insert({
            protocolo: ops.gerarProtocolo(new Date(s.criada)), cliente_id: cliente.id,
            contrato_id: s.contrato == null ? null : criados[s.contrato].id,
            tipo: s.tipo, valor_desejado: s.valor_desejado, prazo_desejado: s.prazo_desejado || null,
            status: s.status, observacao: s.observacao || null, mensagem: s.mensagem || null,
            created_at: s.criada, updated_at: s.eventos[s.eventos.length - 1][2],
        }).select('id').single();
        if (erroS) throw erroS;
        const { error: erroE } = await db.from('solicitacao_eventos').insert(
            s.eventos.map(([status, descricao, created_at]) => ({ solicitacao_id: data.id, status, descricao, created_at })),
        );
        if (erroE) throw erroE;
    }

    const cpfFormatado = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    fs.writeFileSync(ARQUIVO, [
        'USUÁRIO DE TESTE — Área do Cliente Antecipey',
        '',
        'Endereço: https://www.antecipey.com.br/cliente',
        `CPF:   ${cpfFormatado}`,
        `Senha: ${senha}`,
        '',
        'Tem 3 contratos (2 ativos e 1 quitado), 3 solicitações (em análise, pendente e paga) e PDF de contrato.',
        'Para recriar do zero: node scripts/criar-usuario-teste.js',
        '',
    ].join('\n'));
    console.log(`Cliente de teste criado (CPF ${seg.mascararCpf(cpf)}). Dados de acesso em USUARIO-TESTE.txt`);
}

principal().catch((erro) => {
    console.error(erro);
    process.exit(1);
});
