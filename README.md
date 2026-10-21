# Antecipey

Site institucional da Antecipey: https://www.antecipey.com.br

## Estrutura

- `index.html`: página inicial (Tailwind via CDN, fonte Sora)
- `servicos.html` / `servico.html`: lista e detalhe dos serviços
- `admin.html`: painel para editar textos, depoimentos, FAQ e serviços
- `server.js`: servidor Express que entrega as páginas e a API (`/api/*`), lendo e gravando no Supabase
- `assets/`: imagens

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha as variáveis
npm start              # http://localhost:3000
```

## Tabelas do Supabase usadas

`testimonials`, `faq`, `services` e `content` (chave/valor dos textos do site).
