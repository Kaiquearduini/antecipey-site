-- Tabelas do site Antecipey (usadas pelo server.js)
-- RLS ligado e sem políticas: só o servidor (service role) lê e grava.

create table if not exists services (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    subtitle    text,
    paragraph   text,
    cover_url   text,
    category    text,
    features    jsonb not null default '[]',
    active      boolean not null default true,
    highlighted boolean not null default false,
    position    integer not null default 0,
    created_at  timestamptz not null default now()
);

create table if not exists testimonials (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    role       text,
    text       text,
    avatar_url text,
    position   integer not null default 0,
    active     boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists faq (
    id         uuid primary key default gen_random_uuid(),
    question   text not null,
    answer     text,
    position   integer not null default 0,
    active     boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists site_content (
    key     text primary key,
    value   text,
    section text
);

alter table services     enable row level security;
alter table testimonials enable row level security;
alter table faq          enable row level security;
alter table site_content enable row level security;

-- Serviços iniciais (os mesmos que já aparecem em servicos.html)
insert into services (name, subtitle, category, paragraph, position)
select * from (values
    ('Possibilidade de crédito até para negativados', 'Condições acessíveis', 'Crédito',
     'Condições acessíveis para te ajudar a organizar sua vida financeira sem complicação.', 1),
    ('100% digital e seguro.', 'Direto pelo celular', 'Digital',
     'Tudo de forma rápida, simples e sem burocracia, direto pelo celular.', 2),
    ('As melhores taxas com total transparência', 'Sem letras miúdas', 'Taxas',
     'Sem letras miúdas e com condições claras para você contratar com confiança.', 3)
) as v(name, subtitle, category, paragraph, position)
where not exists (select 1 from services);
