-- Área do Cliente (cliente.html + rotas /api/cliente e /api/integracao do server.js)
-- RLS ligado e sem políticas: só o servidor (service role) lê e grava.
-- Pode rodar de novo sem quebrar nada (if not exists).

create table if not exists clientes (
    id                uuid primary key default gen_random_uuid(),
    cpf               char(11) not null unique check (cpf ~ '^[0-9]{11}$'),
    nome              text not null,
    email             text,
    telefone          text,
    senha_hash        text,
    sessao_versao     integer not null default 1,
    tentativas_falhas integer not null default 0,
    bloqueado_ate     timestamptz,
    ultimo_acesso     timestamptz,
    chat_dia          date,
    chat_total        integer not null default 0,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create table if not exists contratos (
    id                  uuid primary key default gen_random_uuid(),
    cliente_id          uuid not null references clientes(id) on delete cascade,
    numero              text not null unique,
    produto             text not null,
    convenio            text,
    banco               text,
    valor_liberado      numeric(12,2) not null check (valor_liberado >= 0),
    valor_parcela       numeric(12,2) not null check (valor_parcela >= 0),
    taxa_mensal         numeric(6,3) not null check (taxa_mensal >= 0),  -- % ao mês
    cet_anual           numeric(7,3),                                    -- % ao ano
    prazo               integer not null check (prazo > 0),
    parcelas_pagas      integer not null default 0 check (parcelas_pagas >= 0),
    data_contratacao    date not null,
    primeiro_vencimento date,
    status              text not null default 'ativo'
                        check (status in ('em_averbacao','ativo','quitado','cancelado')),
    documento_path      text,  -- caminho no bucket privado "documentos"
    created_at          timestamptz not null default now(),
    check (parcelas_pagas <= prazo)
);
create index if not exists contratos_cliente_idx on contratos (cliente_id);

create table if not exists solicitacoes (
    id             uuid primary key default gen_random_uuid(),
    protocolo      text not null unique,
    cliente_id     uuid not null references clientes(id) on delete cascade,
    contrato_id    uuid references contratos(id) on delete set null,
    tipo           text not null
                   check (tipo in ('nova_proposta','refinanciamento','portabilidade','atendimento')),
    valor_desejado numeric(12,2) check (valor_desejado is null or valor_desejado > 0),
    prazo_desejado integer check (prazo_desejado is null or prazo_desejado > 0),
    status         text not null default 'recebida'
                   check (status in ('recebida','em_analise','pendente','aprovada','reprovada','paga','cancelada')),
    observacao     text,  -- o que o cliente escreveu
    mensagem       text,  -- recado da equipe para o cliente
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists solicitacoes_cliente_idx on solicitacoes (cliente_id, created_at desc);

create table if not exists solicitacao_eventos (
    id             uuid primary key default gen_random_uuid(),
    solicitacao_id uuid not null references solicitacoes(id) on delete cascade,
    status         text not null,
    descricao      text,
    created_at     timestamptz not null default now()
);
create index if not exists solicitacao_eventos_idx on solicitacao_eventos (solicitacao_id, created_at);

alter table clientes            enable row level security;
alter table contratos           enable row level security;
alter table solicitacoes        enable row level security;
alter table solicitacao_eventos enable row level security;

-- Bucket privado para contratos e documentos (acesso só por link assinado do servidor)
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;
