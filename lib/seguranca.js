// Senhas, sessão do cliente e validações usadas pela Área do Cliente
const crypto = require('crypto');

const COOKIE_SESSAO = 'ant_cliente';
const SESSAO_HORAS = 8;

// ── CPF ──
function limparCpf(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function cpfValido(valor) {
    const cpf = limparCpf(valor);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const digito = (n) => {
        let soma = 0;
        for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function mascararCpf(cpf) {
    return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

// ── Senha (scrypt) ──
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(senha, salt, params) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(senha, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 },
            (err, chave) => (err ? reject(err) : resolve(chave)));
    });
}

async function gerarHashSenha(senha) {
    const salt = crypto.randomBytes(16);
    const chave = await scryptAsync(senha, salt, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), chave.toString('base64')].join('$');
}

// Hash descartável: quando o CPF não existe, ainda gastamos o mesmo tempo
// para não revelar quais CPFs têm cadastro.
let hashFalso;
async function conferirSenha(senha, hash) {
    if (!hash) {
        hashFalso = hashFalso || await gerarHashSenha(crypto.randomBytes(16).toString('hex'));
        await conferirSenha(senha, hashFalso);
        return false;
    }
    const [tipo, N, r, p, salt, esperado] = hash.split('$');
    if (tipo !== 'scrypt') return false;
    const esperadoBuf = Buffer.from(esperado, 'base64');
    const chave = await scryptAsync(String(senha), Buffer.from(salt, 'base64'),
        { N: Number(N), r: Number(r), p: Number(p), keylen: esperadoBuf.length });
    return crypto.timingSafeEqual(chave, esperadoBuf);
}

function senhaForte(senha) {
    const s = String(senha || '');
    return s.length >= 8 && s.length <= 128 && /[A-Za-z]/.test(s) && /\d/.test(s);
}

// ── Sessão (token assinado com HMAC, guardado em cookie HttpOnly) ──
function segredoSessao() {
    const segredo = process.env.SESSION_SECRET;
    if (!segredo || segredo.length < 32) throw new Error('SESSION_SECRET ausente ou curto');
    return segredo;
}

function assinar(texto) {
    return crypto.createHmac('sha256', segredoSessao()).update(texto).digest('base64url');
}

function criarTokenSessao(cliente) {
    const dados = Buffer.from(JSON.stringify({
        sub: cliente.id,
        v: cliente.sessao_versao,
        exp: Date.now() + SESSAO_HORAS * 3600 * 1000,
    })).toString('base64url');
    return `${dados}.${assinar(dados)}`;
}

function lerTokenSessao(token) {
    if (!token || typeof token !== 'string') return null;
    const [dados, assinatura] = token.split('.');
    if (!dados || !assinatura) return null;
    const esperado = Buffer.from(assinar(dados));
    const recebido = Buffer.from(assinatura);
    if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
    try {
        const sessao = JSON.parse(Buffer.from(dados, 'base64url').toString());
        return sessao.exp > Date.now() ? sessao : null;
    } catch {
        return null;
    }
}

function lerCookie(req, nome) {
    const cabecalho = req.headers.cookie || '';
    for (const parte of cabecalho.split(';')) {
        const [chave, ...resto] = parte.trim().split('=');
        if (chave === nome) return decodeURIComponent(resto.join('='));
    }
    return null;
}

function cookieSessao(req, valor, maxAgeSeg) {
    const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
    return [
        `${COOKIE_SESSAO}=${encodeURIComponent(valor)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAgeSeg}`,
        seguro ? 'Secure' : null,
    ].filter(Boolean).join('; ');
}

// Comparação de chaves sem vazar tempo
function chavesIguais(a, b) {
    if (!a || !b) return false;
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
    COOKIE_SESSAO, SESSAO_HORAS,
    limparCpf, cpfValido, mascararCpf,
    gerarHashSenha, conferirSenha, senhaForte,
    criarTokenSessao, lerTokenSessao, lerCookie, cookieSessao,
    chavesIguais,
};
