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
  password_hash text,
  created_at    timestamptz not null default now()
);
create unique index members_name_group_unique on members (group_id, lower(name));

-- Expenses
create table expenses (
  id          uuid primary key default uuid_generate_v4(),
  group_id    uuid not null references groups(id) on delete cascade,
  paid_by     uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  description text not null,
  entered_by  uuid not null references members(id) on delete cascade,
  created_at  timestamptz not null default now()
);

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
  m.id, m.name, m.is_admin, m.group_id,
  coalesce((select sum(e.amount) from expenses e where e.paid_by = m.id), 0) as total_paid,
  coalesce((select sum(es.amount) from expense_splits es where es.member_id = m.id), 0) as total_owed,
  coalesce((select sum(e.amount) from expenses e where e.paid_by = m.id), 0)
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

-- Receipt attached to an expense (optional, 1:1)
create table receipts (
  id                    uuid primary key default uuid_generate_v4(),
  expense_id            uuid not null references expenses(id) on delete cascade unique,
  image_url             text not null,
  cloudinary_public_id  text not null,
  raw_ocr_json          jsonb,
  parsed_total          numeric(10,2),
  direction             text not null default 'ltr',
  ocr_status            text not null default 'ok',
  created_at            timestamptz not null default now()
);

-- Parsed line items (as edited/confirmed by the entering member before submit).
-- y_center_pct (0-100) is the item's vertical position on the receipt image, used to
-- align each member's review checkbox next to the actual line in ReviewReceiptModal.
-- Null when the position is unknown (e.g. a row added manually, not from OCR).
create table receipt_items (
  id            uuid primary key default uuid_generate_v4(),
  receipt_id    uuid not null references receipts(id) on delete cascade,
  description   text not null,
  amount        numeric(10,2) not null check (amount >= 0),
  sort_order    integer not null default 0,
  y_center_pct  numeric(5,2)
);

-- Opt-out membership: a row means "this member currently consumes this item".
-- Seeded for every (item, splitAmong-member) pair at creation = everyone-in-every-item default.
-- Reviewing = deleting your own row for items you didn't have.
create table receipt_item_members (
  id         uuid primary key default uuid_generate_v4(),
  item_id    uuid not null references receipt_items(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  unique (item_id, member_id)
);

-- Per-member "have they opened the review flow yet" marker, independent of whether they changed anything.
create table receipt_reviews (
  id           uuid primary key default uuid_generate_v4(),
  receipt_id   uuid not null references receipts(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  reviewed_at  timestamptz,
  unique (receipt_id, member_id)
);

alter table receipts enable row level security;
create policy "public read" on receipts for select using (true);
create policy "service write" on receipts for all using (true) with check (true);
alter table receipt_items enable row level security;
create policy "public read" on receipt_items for select using (true);
create policy "service write" on receipt_items for all using (true) with check (true);
alter table receipt_item_members enable row level security;
create policy "public read" on receipt_item_members for select using (true);
create policy "service write" on receipt_item_members for all using (true) with check (true);
alter table receipt_reviews enable row level security;
create policy "public read" on receipt_reviews for select using (true);
create policy "service write" on receipt_reviews for all using (true) with check (true);
