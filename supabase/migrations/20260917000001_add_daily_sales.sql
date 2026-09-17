-- Run this after 20260917000000_create_products.sql.
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  sold_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.sales enable row level security;

create policy "Users can view their own sales"
  on public.sales for select using (auth.uid() = user_id);
create policy "Users can add their own sales"
  on public.sales for insert with check (auth.uid() = user_id);
create policy "Users can delete their own sales"
  on public.sales for delete using (auth.uid() = user_id);

-- Records a sale and deducts stock in one transaction.
create or replace function public.record_sale(p_product_id uuid, p_quantity integer, p_sold_at date default current_date)
returns public.sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  product_row public.products;
  new_sale public.sales;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be at least 1';
  end if;

  select * into product_row from public.products
  where id = p_product_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Product not found';
  end if;
  if product_row.quantity < p_quantity then
    raise exception 'Only % unit(s) of % are in stock', product_row.quantity, product_row.name;
  end if;

  update public.products set quantity = quantity - p_quantity where id = product_row.id;
  insert into public.sales (user_id, product_id, quantity, unit_cost, unit_price, sold_at)
  values (auth.uid(), product_row.id, p_quantity, product_row.cost_price, product_row.selling_price, coalesce(p_sold_at, current_date))
  returning * into new_sale;
  return new_sale;
end;
$$;
