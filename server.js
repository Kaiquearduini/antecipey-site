require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// Supabase com service role key — nunca exposta ao browser
const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

app.use(express.json());
app.use(express.static(__dirname)); // serve os arquivos estáticos

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/servicos', (req, res) => {
    res.sendFile(path.join(__dirname, 'servicos.html'));
});

app.get('/servico', (req, res) => {
    res.sendFile(path.join(__dirname, 'servico.html'));
});

// ── Middleware de autenticação para rotas admin ──
function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Não autorizado' });
    }
    next();
}

// ════════════════════════════════
//  ROTAS PÚBLICAS (site)
// ════════════════════════════════

// Depoimentos ativos
app.get('/api/testimonials', async (req, res) => {
    const { data, error } = await db
        .from('testimonials')
        .select('id,name,role,text,avatar_url,position')
        .eq('active', true)
        .order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// FAQ ativo
app.get('/api/faq', async (req, res) => {
    const { data, error } = await db
        .from('faq')
        .select('id,question,answer,position')
        .eq('active', true)
        .order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Serviços públicos
app.get('/api/services', async (req, res) => {
    const { data, error } = await db
        .from('services')
        .select('*')
        .eq('active', true)
        .order('highlighted', { ascending: false })
        .order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Conteúdo do site
app.get('/api/content', async (req, res) => {
    const { data, error } = await db
        .from('site_content')
        .select('key,value');
    if (error) return res.status(500).json({ error: error.message });
    res.json(Object.fromEntries(data.map(r => [r.key, r.value])));
});

// ════════════════════════════════
//  ROTAS ADMIN (protegidas)
// ════════════════════════════════

// Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        res.json({ ok: true, token: process.env.ADMIN_PASSWORD });
    } else {
        res.status(401).json({ error: 'Senha incorreta' });
    }
});

// ── Depoimentos CRUD ──
app.get('/api/admin/testimonials', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('testimonials').select('*').order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/admin/testimonials', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('testimonials').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.put('/api/admin/testimonials/:id', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('testimonials').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/admin/testimonials/:id', requireAdmin, async (req, res) => {
    const { error } = await db.from('testimonials').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── FAQ CRUD ──
app.get('/api/admin/faq', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('faq').select('*').order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/admin/faq', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('faq').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.put('/api/admin/faq/:id', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('faq').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/admin/faq/:id', requireAdmin, async (req, res) => {
    const { error } = await db.from('faq').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── Services CRUD ──
app.get('/api/admin/services', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('services').select('*').order('position');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/admin/services', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('services').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('services').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/admin/services/:id', requireAdmin, async (req, res) => {
    const { error } = await db.from('services').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── Conteúdo do site CRUD ──
app.get('/api/admin/content', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('site_content').select('*').order('section').order('key');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.put('/api/admin/content/:key', requireAdmin, async (req, res) => {
    const { data, error } = await db.from('site_content').update({ value: req.body.value }).eq('key', req.params.key).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`✅ Antecipey rodando em http://localhost:${PORT}`);
    console.log(`   Admin:  http://localhost:${PORT}/admin.html`);
    console.log(`   Site:   http://localhost:${PORT}/index.html`);
});
