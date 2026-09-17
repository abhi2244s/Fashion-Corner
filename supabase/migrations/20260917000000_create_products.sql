-- Run this migration in the Supabase SQL Editor, or via the Supabase CLI.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) > 0),
  category text not null default 'Uncategorized',
  sku text,
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  selling_price numeric(12, 2) not null check (selling_price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "Users can view their own products"
  on public.products for select using (auth.uid() = user_id);
create policy "Users can add their own products"
  on public.products for insert with check (auth.uid() = user_id);
create policy "Users can update their own products"
  on public.products for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own products"
  on public.products for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
