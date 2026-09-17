-- Preserve historical sales when their product is deleted, and add atomic sale edits.
alter table public.sales
  alter column product_id drop not null;

alter table public.sales
  drop constraint if exists sales_product_id_fkey;

alter table public.sales
  add constraint sales_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

create policy "Users can update their own sales"
  on public.sales for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Records a sale with the actual amount received per unit.
create or replace function public.record_sale_with_amount(
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_sold_at date default current_date
)
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
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'Amount must be zero or more';
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
  values (auth.uid(), product_row.id, p_quantity, product_row.cost_price, p_unit_price, coalesce(p_sold_at, current_date))
  returning * into new_sale;
  return new_sale;
end;
$$;

create or replace function public.update_sale(
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_sold_at date
)
returns public.sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_sale public.sales;
  product_row public.products;
  updated_sale public.sales;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be at least 1';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'Amount must be zero or more';
  end if;

  select * into old_sale from public.sales
  where id = p_sale_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if old_sale.product_id is not null then
    update public.products set quantity = quantity + old_sale.quantity
    where id = old_sale.product_id and user_id = auth.uid();
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
  update public.sales
  set product_id = product_row.id,
      quantity = p_quantity,
      unit_cost = product_row.cost_price,
      unit_price = p_unit_price,
      sold_at = coalesce(p_sold_at, current_date)
  where id = old_sale.id
  returning * into updated_sale;
  return updated_sale;
end;
$$;

create or replace function public.delete_sale(p_sale_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  sale_row public.sales;
begin
  select * into sale_row from public.sales
  where id = p_sale_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if sale_row.product_id is not null then
    update public.products set quantity = quantity + sale_row.quantity
    where id = sale_row.product_id and user_id = auth.uid();
  end if;
  delete from public.sales where id = sale_row.id;
end;
$$;
