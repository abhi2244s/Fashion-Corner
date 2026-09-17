-- Allow each unit in one sale to have a different selling price.
alter table public.sales
  add column if not exists unit_prices numeric[];

update public.sales
set unit_prices = array_fill(unit_price, array[quantity])
where unit_prices is null;

create or replace function public.record_sale_with_prices(
  p_product_id uuid,
  p_unit_prices numeric[],
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
  sale_quantity integer;
  average_price numeric;
begin
  sale_quantity := coalesce(array_length(p_unit_prices, 1), 0);
  if sale_quantity <= 0 then
    raise exception 'Enter at least one selling amount';
  end if;
  if exists (select 1 from unnest(p_unit_prices) price where price is null or price < 0) then
    raise exception 'Every selling amount must be zero or more';
  end if;
  select avg(price) into average_price from unnest(p_unit_prices) price;

  select * into product_row from public.products
  where id = p_product_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if product_row.quantity < sale_quantity then
    raise exception 'Only % unit(s) of % are in stock', product_row.quantity, product_row.name;
  end if;

  update public.products set quantity = quantity - sale_quantity where id = product_row.id;
  insert into public.sales (user_id, product_id, quantity, unit_cost, unit_price, unit_prices, sold_at)
  values (auth.uid(), product_row.id, sale_quantity, product_row.cost_price, average_price, p_unit_prices, coalesce(p_sold_at, current_date))
  returning * into new_sale;
  return new_sale;
end;
$$;

create or replace function public.update_sale_with_prices(
  p_sale_id uuid,
  p_product_id uuid,
  p_unit_prices numeric[],
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
  sale_quantity integer;
  average_price numeric;
begin
  sale_quantity := coalesce(array_length(p_unit_prices, 1), 0);
  if sale_quantity <= 0 then
    raise exception 'Enter at least one selling amount';
  end if;
  if exists (select 1 from unnest(p_unit_prices) price where price is null or price < 0) then
    raise exception 'Every selling amount must be zero or more';
  end if;
  select avg(price) into average_price from unnest(p_unit_prices) price;

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
  if product_row.quantity < sale_quantity then
    raise exception 'Only % unit(s) of % are in stock', product_row.quantity, product_row.name;
  end if;

  update public.products set quantity = quantity - sale_quantity where id = product_row.id;
  update public.sales
  set product_id = product_row.id,
      quantity = sale_quantity,
      unit_cost = product_row.cost_price,
      unit_price = average_price,
      unit_prices = p_unit_prices,
      sold_at = coalesce(p_sold_at, current_date)
  where id = old_sale.id
  returning * into updated_sale;
  return updated_sale;
end;
$$;
