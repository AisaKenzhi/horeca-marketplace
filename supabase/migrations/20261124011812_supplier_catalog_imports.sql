-- Supplier catalog imports use private staging and narrow authenticated RPCs.
-- A Product is a separate domain record; each new supplier SKU gets its own Product
-- unless a future curated matching process explicitly links offers to a shared Product.
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 180),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  created_at timestamptz not null default now()
);

alter table public.catalog_offers
  add column product_id uuid references public.catalog_products(id) on delete restrict;

create index catalog_offers_product_idx
  on public.catalog_offers(product_id)
  where product_id is not null;

create table public.supplier_catalog_imports (
  id uuid primary key default gen_random_uuid(),
  supplier_organization_id uuid not null
    references public.supplier_profiles(organization_id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  payload_fingerprint text not null,
  payload jsonb not null,
  preview jsonb not null,
  status text not null check (status in ('previewed', 'blocked', 'applied')),
  result jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (supplier_organization_id, idempotency_key)
);

alter table public.catalog_products enable row level security;
alter table public.supplier_catalog_imports enable row level security;

create policy catalog_products_select_visible_offer
  on public.catalog_products for select to authenticated
  using (
    exists (
      select 1
      from public.catalog_offers as offer
      where offer.product_id = catalog_products.id
    )
  );

-- Import staging is accessed only by the security-checked worker functions.
revoke all on table public.catalog_products, public.supplier_catalog_imports
  from public, anon, authenticated;
grant select on table public.catalog_products to authenticated;

create or replace function private.preview_supplier_catalog_import_worker(
  p_organization_id uuid,
  p_idempotency_key uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_supplier_status text;
  v_fingerprint text;
  v_job public.supplier_catalog_imports%rowtype;
  v_preview jsonb := '[]'::jsonb;
  v_row jsonb;
  v_values jsonb;
  v_errors jsonb;
  v_changes jsonb;
  v_sku text;
  v_title text;
  v_category text;
  v_sell_unit text;
  v_pack_unit text;
  v_availability text;
  v_action text;
  v_row_number integer;
  v_existing public.catalog_offers%rowtype;
  v_exists boolean;
  v_count integer := 0;
  v_duplicate_count integer;
  v_blocked boolean := false;
  v_summary jsonb;
  v_numeric numeric;
  v_field record;
  v_error_item jsonb;
begin
  if v_uid is null or p_organization_id is null or p_idempotency_key is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.role
  into v_role
  from public.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_uid
    and membership.role in ('owner', 'admin', 'catalog_operator')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select profile.verification_status
  into v_supplier_status
  from public.supplier_profiles as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
  where profile.organization_id = p_organization_id
    and organization.organization_type = 'supplier'
  for share of profile;
  if not found or v_supplier_status is null
     or v_supplier_status not in ('pending', 'approved') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  -- The 512 KB UI cap applies to raw CSV; normalized JSON repeats field names and
  -- row metadata and may escape cell text. Keep a strict 4 MB RPC-envelope cap.
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '23514', message = 'invalid import payload';
  elsif pg_catalog.jsonb_array_length(p_rows) < 1
     or pg_catalog.jsonb_array_length(p_rows) > 2000
     or pg_catalog.octet_length(p_rows::text) > 4000000 then
    raise exception using errcode = '23514', message = 'invalid import payload';
  end if;

  v_fingerprint := pg_catalog.md5(p_rows::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text),
    pg_catalog.hashtext(p_idempotency_key::text)
  );

  select *
  into v_job
  from public.supplier_catalog_imports as job
  where job.supplier_organization_id = p_organization_id
    and job.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_job.payload_fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency key conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'import_id', v_job.id,
      'status', v_job.status,
      'summary', v_job.preview -> 'summary',
      'rows', v_job.preview -> 'rows'
    );
  end if;

  for v_row in
    select input_row.value
    from pg_catalog.jsonb_array_elements(p_rows) as input_row(value)
  loop
    v_count := v_count + 1;
    v_values := null;
    v_sku := null;
    v_title := null;
    v_category := null;
    v_sell_unit := null;
    v_pack_unit := null;
    v_availability := null;
    v_row_number := null;
    v_exists := false;
    v_action := 'error';
    v_changes := '[]'::jsonb;

    if pg_catalog.jsonb_typeof(v_row) <> 'object' then
      v_errors := pg_catalog.jsonb_build_array('malformed_row');
    elsif (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_row)) <> 3
       or not (v_row ?& array['row_number', 'values', 'client_errors']) then
      v_errors := pg_catalog.jsonb_build_array('malformed_row');
    else
      v_errors := '[]'::jsonb;
      if pg_catalog.jsonb_typeof(v_row -> 'client_errors') <> 'array' then
        v_errors := v_errors || pg_catalog.jsonb_build_array('malformed_client_errors');
      else
        for v_error_item in
          select item.value
          from pg_catalog.jsonb_array_elements(v_row -> 'client_errors') as item(value)
        loop
          if pg_catalog.jsonb_typeof(v_error_item) <> 'string' then
            v_errors := v_errors || pg_catalog.jsonb_build_array('malformed_client_error');
          else
            v_errors := v_errors || pg_catalog.jsonb_build_array(v_error_item #>> '{}');
          end if;
        end loop;
      end if;

      if pg_catalog.jsonb_typeof(v_row -> 'row_number') <> 'number'
         or coalesce(v_row ->> 'row_number', '') !~ '^[1-9][0-9]{0,5}$' then
        v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_row_number');
      else
        v_row_number := (v_row ->> 'row_number')::integer;
      end if;

      v_values := v_row -> 'values';
      if pg_catalog.jsonb_typeof(v_values) <> 'object' then
        v_errors := v_errors || pg_catalog.jsonb_build_array('malformed_values');
      elsif (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_values)) <> 12
         or not (v_values ?& array[
           'sku', 'title', 'category', 'sell_unit_label', 'units_per_sell_unit',
           'pack_amount', 'pack_base_unit', 'price_amount', 'currency', 'moq',
           'order_step', 'availability'
         ]) then
        v_errors := v_errors || pg_catalog.jsonb_build_array('missing_or_extra_fields');
      else
        for v_field in
          select item.key, item.value
          from pg_catalog.jsonb_each(v_values) as item(key, value)
        loop
          if pg_catalog.jsonb_typeof(v_field.value) <> 'string' then
            v_errors := v_errors || pg_catalog.jsonb_build_array('field_must_be_text');
          end if;
        end loop;

        v_sku := v_values ->> 'sku';
        v_title := v_values ->> 'title';
        v_category := v_values ->> 'category';
        v_sell_unit := v_values ->> 'sell_unit_label';
        v_pack_unit := v_values ->> 'pack_base_unit';
        v_availability := coalesce(nullif(v_values ->> 'availability', ''), 'unknown');

        if v_sku is null or v_sku <> pg_catalog.btrim(v_sku)
           or pg_catalog.char_length(pg_catalog.btrim(coalesce(v_sku, ''))) not between 1 and 80 then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_sku');
        end if;
        if v_title is null or pg_catalog.char_length(pg_catalog.btrim(v_title)) not between 1 and 180 then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_title');
        end if;
        if v_category is null or pg_catalog.char_length(pg_catalog.btrim(v_category)) not between 1 and 80 then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_category');
        end if;
        if v_sell_unit is null or pg_catalog.char_length(pg_catalog.btrim(v_sell_unit)) not between 1 and 120 then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_sell_unit');
        end if;

        if coalesce(v_values ->> 'units_per_sell_unit', '') !~ '^[0-9]{1,10}$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
        else
          v_numeric := (v_values ->> 'units_per_sell_unit')::numeric;
          if v_numeric not between 1 and 2147483647 then
            v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
          end if;
        end if;
        if coalesce(v_values ->> 'moq', '') !~ '^[0-9]{1,10}$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
        else
          v_numeric := (v_values ->> 'moq')::numeric;
          if v_numeric not between 1 and 2147483647 then
            v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
          end if;
        end if;
        if coalesce(v_values ->> 'order_step', '') !~ '^[0-9]{1,10}$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
        else
          v_numeric := (v_values ->> 'order_step')::numeric;
          if v_numeric not between 1 and 2147483647 then
            v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_integer');
          end if;
        end if;

        if coalesce(v_values ->> 'pack_amount', '') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_pack_amount');
        else
          v_numeric := (v_values ->> 'pack_amount')::numeric;
          if v_numeric <= 0 then
            v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_pack_amount');
          end if;
        end if;
        if coalesce(v_pack_unit, '') not in ('kg', 'l', 'piece') then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_pack_unit');
        end if;
        if v_availability not in ('in_stock', 'low_stock', 'out_of_stock', 'on_request', 'unknown') then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_availability');
        end if;
        if coalesce(v_values ->> 'price_amount', '') !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_price');
        else
          v_numeric := (v_values ->> 'price_amount')::numeric;
          if v_numeric <= 0 then
            v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_price');
          end if;
        end if;
        if coalesce(v_values ->> 'currency', '') !~ '^[A-Z]{3}$' then
          v_errors := v_errors || pg_catalog.jsonb_build_array('invalid_currency');
        end if;
      end if;
    end if;

    if v_sku is not null then
      select pg_catalog.count(*)
      into v_duplicate_count
      from pg_catalog.jsonb_array_elements(p_rows) as input_row(value)
      where input_row.value -> 'values' ->> 'sku' = v_sku;
      if v_duplicate_count > 1 then
        v_errors := v_errors || pg_catalog.jsonb_build_array('duplicate_sku');
      end if;
    end if;

    if pg_catalog.jsonb_array_length(v_errors) > 0 then
      v_action := 'error';
    else
      select *
      into v_existing
      from public.catalog_offers as offer
      where offer.supplier_organization_id = p_organization_id
        and offer.supplier_sku = v_sku;
      v_exists := found;

      if not v_exists then
        v_action := 'create';
        v_changes := pg_catalog.jsonb_build_array('Новая позиция');
      else
        if v_existing.title is distinct from v_title then
          v_changes := v_changes || pg_catalog.jsonb_build_array(
            'Название: ' || v_existing.title || ' → ' || v_title
          );
        end if;
        if v_existing.category is distinct from v_category then
          v_changes := v_changes || pg_catalog.jsonb_build_array(
            'Категория: ' || v_existing.category || ' → ' || v_category
          );
        end if;
        if v_existing.sell_unit_label is distinct from v_sell_unit then
          v_changes := v_changes || pg_catalog.jsonb_build_array(
            'Продаваемая единица: ' || v_existing.sell_unit_label || ' → ' || v_sell_unit
          );
        end if;
        if v_existing.units_per_sell_unit is distinct from (v_values ->> 'units_per_sell_unit')::integer then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Количество единиц в продаже изменено');
        end if;
        if v_existing.pack_amount is distinct from (v_values ->> 'pack_amount')::numeric then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Размер упаковки изменён');
        end if;
        if v_existing.pack_base_unit is distinct from v_pack_unit then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Базовая единица упаковки изменена');
        end if;
        if v_existing.price_amount is distinct from (v_values ->> 'price_amount')::numeric then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Цена изменена');
        end if;
        if v_existing.currency is distinct from (v_values ->> 'currency') then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Валюта изменена');
        end if;
        if v_existing.moq is distinct from (v_values ->> 'moq')::integer then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Минимальный заказ изменён');
        end if;
        if v_existing.order_step is distinct from (v_values ->> 'order_step')::integer then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Шаг заказа изменён');
        end if;
        if v_existing.availability is distinct from v_availability then
          v_changes := v_changes || pg_catalog.jsonb_build_array('Доступность изменена');
        end if;

        if pg_catalog.jsonb_array_length(v_changes) = 0 then
          v_action := 'unchanged';
        elsif v_supplier_status = 'pending' then
          v_action := 'error';
          v_errors := v_errors || pg_catalog.jsonb_build_array('approval_required_for_existing_offer');
        else
          v_action := 'update';
        end if;
      end if;
    end if;

    if v_action = 'error' then
      v_blocked := true;
    end if;
    v_preview := v_preview || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'row_number', coalesce(v_row_number, v_count),
        'sku', v_sku,
        'action', v_action,
        'status', case v_action
          when 'create' then 'added'
          when 'update' then 'updated'
          when 'unchanged' then 'unchanged'
          else 'error'
        end,
        'errors', v_errors,
        'changes', v_changes,
        'expected_version', case when v_exists then v_existing.version else null end
      )
    );
  end loop;

  select pg_catalog.jsonb_build_object(
    'added', pg_catalog.count(*) filter (where entry.value ->> 'action' = 'create'),
    'updated', pg_catalog.count(*) filter (where entry.value ->> 'action' = 'update'),
    'unchanged', pg_catalog.count(*) filter (where entry.value ->> 'action' = 'unchanged'),
    'errors', pg_catalog.count(*) filter (where entry.value ->> 'action' = 'error')
  )
  into v_summary
  from pg_catalog.jsonb_array_elements(v_preview) as entry(value);

  insert into public.supplier_catalog_imports (
    supplier_organization_id,
    created_by,
    idempotency_key,
    payload_fingerprint,
    payload,
    preview,
    status
  )
  values (
    p_organization_id,
    v_uid,
    p_idempotency_key,
    v_fingerprint,
    p_rows,
    pg_catalog.jsonb_build_object('summary', v_summary, 'rows', v_preview),
    case when v_blocked then 'blocked' else 'previewed' end
  )
  returning * into v_job;

  return pg_catalog.jsonb_build_object(
    'import_id', v_job.id,
    'status', v_job.status,
    'summary', v_summary,
    'rows', v_preview
  );
end;
$$;

revoke all on function private.preview_supplier_catalog_import_worker(uuid, uuid, jsonb)
  from public, anon;
grant execute on function private.preview_supplier_catalog_import_worker(uuid, uuid, jsonb)
  to authenticated;

create or replace function private.apply_supplier_catalog_import_worker(
  p_organization_id uuid,
  p_import_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_supplier_status text;
  v_job public.supplier_catalog_imports%rowtype;
  v_item jsonb;
  v_values jsonb;
  v_offer public.catalog_offers%rowtype;
  v_found boolean;
  v_product uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_result jsonb;
  v_lock_sku text;
begin
  if v_uid is null or p_organization_id is null or p_import_id is null then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.role
  into v_role
  from public.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_uid
    and membership.role in ('owner', 'admin', 'catalog_operator')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select profile.verification_status
  into v_supplier_status
  from public.supplier_profiles as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
  where profile.organization_id = p_organization_id
    and organization.organization_type = 'supplier'
  for share of profile;
  if not found or v_supplier_status is null
     or v_supplier_status not in ('pending', 'approved') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select *
  into v_job
  from public.supplier_catalog_imports as job
  where job.id = p_import_id
    and job.supplier_organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_job.status = 'applied' then
    return v_job.result;
  end if;
  if v_job.status <> 'previewed' then
    raise exception using errcode = '23514', message = 'import is blocked';
  end if;

  -- Serialize concurrent previews for the same tenant/SKU, including absent rows.
  -- Lock the complete set in bytewise order before row locks to avoid deadlocks.
  for v_lock_sku in
    select distinct preview_row.value ->> 'sku' as sku
    from pg_catalog.jsonb_array_elements(v_job.preview -> 'rows') as preview_row(value)
    where preview_row.value ->> 'action' in ('create', 'update', 'unchanged')
    order by sku collate "C"
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(p_organization_id::text),
      pg_catalog.hashtext(v_lock_sku)
    );
  end loop;

  -- Lock and validate every previewed offer before performing any write.
  for v_item in
    select preview_row.value
    from pg_catalog.jsonb_array_elements(v_job.preview -> 'rows') as preview_row(value)
    order by (preview_row.value ->> 'sku') collate "C"
  loop
    if v_item ->> 'action' = 'error' then
      raise exception using errcode = '23514', message = 'import is blocked';
    end if;
    if v_item ->> 'action' = 'update' and v_supplier_status <> 'approved' then
      raise exception using errcode = '42501', message = 'approval required';
    end if;
    if v_item ->> 'action' not in ('create', 'update', 'unchanged') then
      raise exception using errcode = '23514', message = 'invalid staged action';
    end if;

    select *
    into v_offer
    from public.catalog_offers as offer
    where offer.supplier_organization_id = p_organization_id
      and offer.supplier_sku = v_item ->> 'sku'
    for update;
    v_found := found;

    if v_item ->> 'action' = 'create' and v_found then
      raise exception using errcode = '40001', message = 'stale preview';
    elsif v_item ->> 'action' in ('update', 'unchanged')
       and (not v_found or v_offer.version is distinct from (v_item ->> 'expected_version')::integer) then
      raise exception using errcode = '40001', message = 'stale preview';
    end if;
  end loop;

  -- All rows passed validation and version checks. Any SQL error still rolls back
  -- the complete function call, including Product, Offer, and job status writes.
  for v_item in
    select preview_row.value
    from pg_catalog.jsonb_array_elements(v_job.preview -> 'rows') as preview_row(value)
  loop
    if v_item ->> 'action' not in ('create', 'update') then
      continue;
    end if;

    select payload_row.value -> 'values'
    into v_values
    from pg_catalog.jsonb_array_elements(v_job.payload) as payload_row(value)
    where payload_row.value -> 'values' ->> 'sku' = v_item ->> 'sku'
    limit 1;
    if not found then
      raise exception using errcode = '23514', message = 'invalid staged row';
    end if;

    if v_item ->> 'action' = 'create' then
      insert into public.catalog_products(name, category)
      values (v_values ->> 'title', v_values ->> 'category')
      returning id into v_product;

      insert into public.catalog_offers (
        supplier_organization_id,
        product_id,
        supplier_sku,
        title,
        category,
        sell_unit_label,
        units_per_sell_unit,
        pack_amount,
        pack_base_unit,
        price_amount,
        currency,
        moq,
        order_step,
        availability,
        is_published
      )
      values (
        p_organization_id,
        v_product,
        v_values ->> 'sku',
        v_values ->> 'title',
        v_values ->> 'category',
        v_values ->> 'sell_unit_label',
        (v_values ->> 'units_per_sell_unit')::integer,
        (v_values ->> 'pack_amount')::numeric,
        v_values ->> 'pack_base_unit',
        (v_values ->> 'price_amount')::numeric,
        v_values ->> 'currency',
        (v_values ->> 'moq')::integer,
        (v_values ->> 'order_step')::integer,
        coalesce(nullif(v_values ->> 'availability', ''), 'unknown'),
        false
      );
      v_created := v_created + 1;
    else
      select *
      into v_offer
      from public.catalog_offers as offer
      where offer.supplier_organization_id = p_organization_id
        and offer.supplier_sku = v_item ->> 'sku'
      for update;

      if v_offer.product_id is null then
        insert into public.catalog_products(name, category)
        values (v_values ->> 'title', v_values ->> 'category')
        returning id into v_product;
      else
        v_product := v_offer.product_id;
      end if;

      update public.catalog_offers
      set product_id = v_product,
          title = v_values ->> 'title',
          category = v_values ->> 'category',
          sell_unit_label = v_values ->> 'sell_unit_label',
          units_per_sell_unit = (v_values ->> 'units_per_sell_unit')::integer,
          pack_amount = (v_values ->> 'pack_amount')::numeric,
          pack_base_unit = v_values ->> 'pack_base_unit',
          price_amount = (v_values ->> 'price_amount')::numeric,
          currency = v_values ->> 'currency',
          moq = (v_values ->> 'moq')::integer,
          order_step = (v_values ->> 'order_step')::integer,
          availability = coalesce(nullif(v_values ->> 'availability', ''), 'unknown')
      where id = v_offer.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  v_result := pg_catalog.jsonb_build_object(
    'import_id', v_job.id,
    'status', 'applied',
    'summary', v_job.preview -> 'summary'
  );
  update public.supplier_catalog_imports
  set status = 'applied', result = v_result, applied_at = now()
  where id = v_job.id;

  return v_result;
end;
$$;

revoke all on function private.apply_supplier_catalog_import_worker(uuid, uuid)
  from public, anon;
grant execute on function private.apply_supplier_catalog_import_worker(uuid, uuid)
  to authenticated;

create or replace function public.preview_supplier_catalog_import(
  p_organization_id uuid,
  p_idempotency_key uuid,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.preview_supplier_catalog_import_worker(
    p_organization_id,
    p_idempotency_key,
    p_rows
  );
$$;

create or replace function public.apply_supplier_catalog_import(
  p_organization_id uuid,
  p_import_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_catalog_import_worker(p_organization_id, p_import_id);
$$;

revoke all on function public.preview_supplier_catalog_import(uuid, uuid, jsonb)
  from public, anon;
revoke all on function public.apply_supplier_catalog_import(uuid, uuid)
  from public, anon;
grant execute on function public.preview_supplier_catalog_import(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.apply_supplier_catalog_import(uuid, uuid)
  to authenticated;
