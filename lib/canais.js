// Canais de atendimento (SAC) configurados nas variáveis de ambiente
function formatarTelefone(digitos) {
    const d = digitos.replace(/^55(?=\d{10,11}$)/, '');
    if (/^0800\d{7}$/.test(d)) return `0800 ${d.slice(4, 7)} ${d.slice(7)}`;
    if (/^\d{4}\d{4}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 4004-XXXX / 3003-XXXX
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
}

function canaisAtendimento() {
    const whatsapp = String(process.env.SAC_WHATSAPP || '').replace(/\D/g, '');
    const telefone = String(process.env.SAC_TELEFONE || '').replace(/\D/g, '');
    return {
        whatsapp: whatsapp ? `https://wa.me/${whatsapp.length <= 11 ? `55${whatsapp}` : whatsapp}` : null,
        whatsapp_exibicao: whatsapp ? formatarTelefone(whatsapp) : null,
        telefone: telefone ? `tel:${telefone.startsWith('0') || telefone.length <= 8 ? telefone : `+${telefone.length <= 11 ? `55${telefone}` : telefone}`}` : null,
        telefone_exibicao: telefone ? formatarTelefone(telefone) : null,
        email: process.env.SAC_EMAIL || null,
        horario: process.env.SAC_HORARIO || 'Segunda a sexta, das 9h às 18h',
    };
}

module.exports = { canaisAtendimento };
