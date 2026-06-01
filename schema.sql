create extension if not exists "uuid-ossp";

-- Groups (each trip/group gets one)
create table groups (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  code        text not null unique,
  currency    text not null default '€',
  created_by          uuid,
  admin_password_hash text,
  created_at          timestamptz not null default now()
);

-- Members (scoped to a group)
create table members (
  id            uuid primary key default uuid_generate_v4(),
  group_id      uuid not null references groups(id) on delete cascade,
  name          text not null,
  is_admin      boolean not null default false,
  is_left       boolean not null default false,
  password_hash    text,
  starting_balance numeric(10,2) not null default 0,
  created_at       timestamptz not null default now()
);
-- Migration: alter table members add column if not exists is_left boolean not null default false;
create unique index members_name_group_unique on members (group_id, lower(name));

-- Expenses
create table expenses (
  id          uuid primary key default uuid_generate_v4(),
  group_id    uuid not null references groups(id) on delete cascade,
  paid_by     uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  description text not null,
  entered_by  uuid not null references members(id) on delete cascade,
  receipt_url text,
  rating      smallint check (rating >= 1 and rating <= 5),
  created_at  timestamptz not null default now()
);
-- Migration (run once on existing DB):
-- alter table expenses add column if not exists receipt_url text;
-- alter table expenses add column if not exists rating smallint check (rating >= 1 and rating <= 5);

-- Expense payers (multi-payer support)
create table expense_payers (
  id          uuid primary key default uuid_generate_v4(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  unique (expense_id, member_id)
);

-- Expense splits
create table expense_splits (
  id          uuid primary key default uuid_generate_v4(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null,
  unique (expense_id, member_id)
);

-- Balance view
create view member_balances as
select
  m.id, m.name, m.is_admin, m.group_id, m.starting_balance,
  coalesce((select sum(e.amount) from expenses e where e.paid_by = m.id), 0) as total_paid,
  coalesce((select sum(es.amount) from expense_splits es where es.member_id = m.id), 0) as total_owed,
  m.starting_balance
    + coalesce((select sum(e.amount) from expenses e where e.paid_by = m.id), 0)
    + coalesce((select sum(es.amount) from expense_splits es where es.member_id = m.id), 0) as balance
from members m;

-- Pending verifications (P2P device pairing)
create table pending_verifications (
  id          uuid primary key default uuid_generate_v4(),
  group_id    uuid not null references groups(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  code        text not null,
  created_at  timestamptz not null default now()
);

-- QR join tokens (reusable within 120s window for initial scan)
create table qr_tokens (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid not null references groups(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

-- RLS
alter table groups enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table expense_splits enable row level security;
create policy "public read" on groups for select using (true);
create policy "public read" on members for select using (true);
create policy "public read" on expenses for select using (true);
create policy "public read" on expense_splits for select using (true);
create policy "service write" on groups for all using (true) with check (true);
create policy "service write" on members for all using (true) with check (true);
create policy "service write" on expenses for all using (true) with check (true);
create policy "service write" on expense_splits for all using (true) with check (true);
alter table expense_payers enable row level security;
create policy "public read" on expense_payers for select using (true);
create policy "service write" on expense_payers for all using (true) with check (true);
alter table pending_verifications enable row level security;
create policy "public read" on pending_verifications for select using (true);
create policy "service write" on pending_verifications for all using (true) with check (true);
alter table qr_tokens enable row level security;
create policy "service write" on qr_tokens for all using (true) with check (true);
