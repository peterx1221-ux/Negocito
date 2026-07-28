-- ============================================================
-- CUADERNO — esquema de base de datos (Supabase / Postgres)
-- Pega este archivo completo en el SQL Editor de tu proyecto
-- Supabase y ejecútalo una vez.
--
-- Cada tabla tiene su propia fila por usuario (user_id) y
-- Row Level Security (RLS) activado: cada persona solo puede
-- leer y escribir SUS propios datos. No hay datos combinados
-- entre cuentas.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- PRODUCTOS (inventario) ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cost numeric not null default 0,
  price numeric not null default 0,
  stock numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_user_idx on public.products(user_id);

-- ---------- CONFIGURACIÓN (reglas de precio + clave Gemini) ----------
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  low_max numeric not null default 500,
  low_price numeric not null default 1000,
  mid_max numeric not null default 3000,
  mid_percent numeric not null default 40,
  mid_min_profit numeric not null default 500,
  high_percent numeric not null default 35,
  rounding text not null default '990' check (rounding in ('990', '500', 'none')),
  gemini_key text,
  -- Columna calculada: dice si hay una clave guardada SIN exponer el valor real.
  -- El cliente (navegador) solo debe leer esta columna, nunca "gemini_key" directamente.
  gemini_key_set boolean generated always as (gemini_key is not null) stored,
  gemini_model text not null default 'gemini-2.5-flash',
  updated_at timestamptz not null default now()
);

-- ---------- COMPRAS (boletas escaneadas o ingresadas) ----------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,       -- costo total de productos + gasto de viaje
  trip_expense numeric not null default 0, -- bencina/locomoción de esta compra
  item_count integer not null default 0,
  date timestamptz not null default now()
);
create index if not exists purchases_user_idx on public.purchases(user_id);

-- ---------- VENTAS ----------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  qty numeric not null default 1,
  unit_price numeric not null default 0,
  unit_cost numeric not null default 0,
  profit numeric not null default 0,
  buyer_name text,
  is_fiado boolean not null default false,
  paid boolean not null default true,
  date timestamptz not null default now()
);
create index if not exists sales_user_idx on public.sales(user_id);

-- ---------- DEUDORES ----------
create table if not exists public.debtors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  name text not null,
  amount numeric not null default 0,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists debtors_user_idx on public.debtors(user_id);

-- ============================================================
-- ROW LEVEL SECURITY — cada usuario solo ve y modifica lo suyo
-- ============================================================
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.purchases enable row level security;
alter table public.sales enable row level security;
alter table public.debtors enable row level security;

create policy "products: solo dueño" on public.products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "settings: solo dueño" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "purchases: solo dueño" on public.purchases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sales: solo dueño" on public.sales
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "debtors: solo dueño" on public.debtors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Crea automáticamente una fila de settings al registrarse
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
