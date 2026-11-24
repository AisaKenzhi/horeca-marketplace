-- A buyer explicitly records a procurement request as a platform-seller request.
-- This is not an accepted or paid order. Internal supplier suborders stay private.

alter table public.buyer_draft_carts
  add column submitted_at timestamptz;

create table public.buyer_procurement_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  draft_cart_id uuid not null,
  buyer_location_id uuid not null,
  seller_type text not null default 'platform' check (seller_type = 'platform'),
  request_status text not null default 'submitted' check (request_status = 'submitted'),
  source_list_name text not null check (char_length(btrim(source_list_name)) between 1 and 120),
  idempotency_key uuid not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  submitted_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, draft_cart_id),
  foreign key (organization_id, draft_cart_id)
    references public.buyer_draft_carts (organization_id, id) on delete restrict,
  foreign key (organization_id, buyer_location_id)
    references public.buyer_locations (organization_id, id) on delete restrict
);

create table public.buyer_procurement_request_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  catalog_offer_id uuid not null references public.catalog_offers (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 1000000),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  sell_unit_label text not null check (char_length(btrim(sell_unit_label)) between 1 and 120),
  units_per_sell_unit integer not null check (units_per_sell_unit > 0),
  pack_amount numeric(12, 3) not null check (pack_amount > 0),
  pack_base_unit text not null check (pack_base_unit in ('kg', 'l', 'piece')),
  price_amount numeric(16, 4) not null check (price_amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  availability text not null check (availability = 'in_stock'),
  catalog_offer_version integer not null check (catalog_offer_version > 0),
  price_observed_at timestamptz not null,
  availability_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, request_id, id),
  unique (organization_id, request_id, catalog_offer_id),
  foreign key (organization_id, request_id)
    references public.buyer_procurement_requests (organization_id, id) on delete cascade
);

-- Internal-only supplier fulfillment records. `private` is not in the Data API
-- schema allow-list, and these tables receive no client grants or RLS policies.
create table private.platform_supplier_suborders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_organization_id uuid not null
    references public.supplier_profiles (organization_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, buyer_request_id, supplier_organization_id),
  unique (organization_id, buyer_request_id, id, supplier_organization_id),
  foreign key (organization_id, buyer_request_id)
    references public.buyer_procurement_requests (organization_id, id) on delete restrict
);

create table private.platform_supplier_suborder_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_suborder_id uuid not null,
  supplier_organization_id uuid not null,
  buyer_request_line_id uuid not null,
  catalog_offer_id uuid not null references public.catalog_offers (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 1000000),
  created_at timestamptz not null default now(),
  unique (supplier_suborder_id, buyer_request_line_id),
  foreign key (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id)
    references private.platform_supplier_suborders
      (organization_id, buyer_request_id, id, supplier_organization_id) on delete cascade,
  foreign key (organization_id, buyer_request_id, buyer_request_line_id)
    references public.buyer_procurement_request_lines (organization_id, request_id, id) on delete restrict
);

create index buyer_procurement_requests_org_submitted_idx
  on public.buyer_procurement_requests (organization_id, submitted_at desc);
create index buyer_procurement_request_lines_org_request_idx
  on public.buyer_procurement_request_lines (organization_id, request_id);
create index platform_supplier_suborders_supplier_created_idx
  on private.platform_supplier_suborders (supplier_organization_id, created_at desc);
create index platform_supplier_suborder_lines_org_request_idx
  on private.platform_supplier_suborder_lines (organization_id, buyer_request_id);
create index platform_supplier_suborder_lines_offer_idx
  on private.platform_supplier_suborder_lines (catalog_offer_id);

alter table public.buyer_procurement_requests enable row level security;
alter table public.buyer_procurement_request_lines enable row level security;
alter table private.platform_supplier_suborders enable row level security;
alter table private.platform_supplier_suborder_lines enable row level security;

create or replace function private.reject_platform_request_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'submitted procurement request snapshots are immutable';
end;
$$;
revoke all on function private.reject_platform_request_mutation() from public, anon, authenticated;

create trigger buyer_procurement_requests_immutable
  before update or delete on public.buyer_procurement_requests
  for each row execute function private.reject_platform_request_mutation();
create trigger buyer_procurement_request_lines_immutable
  before update or delete on public.buyer_procurement_request_lines
  for each row execute function private.reject_platform_request_mutation();
create trigger platform_supplier_suborders_immutable
  before update or delete on private.platform_supplier_suborders
  for each row execute function private.reject_platform_request_mutation();
create trigger platform_supplier_suborder_lines_immutable
  before update or delete on private.platform_supplier_suborder_lines
  for each row execute function private.reject_platform_request_mutation();

create policy buyer_procurement_requests_select
  on public.buyer_procurement_requests for select to authenticated
  using (
    private.has_org_role(
      organization_id,
      array['owner', 'admin', 'buyer', 'viewer']::text[]
    )
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_procurement_requests.organization_id
        and organization.organization_type = 'buyer'
    )
  );

create policy buyer_procurement_request_lines_select
  on public.buyer_procurement_request_lines for select to authenticated
  using (
    private.has_org_role(
      organization_id,
      array['owner', 'admin', 'buyer', 'viewer']::text[]
    )
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_procurement_request_lines.organization_id
        and organization.organization_type = 'buyer'
    )
    and exists (
      select 1
      from public.buyer_procurement_requests as request
      where request.organization_id = buyer_procurement_request_lines.organization_id
        and request.id = buyer_procurement_request_lines.request_id
    )
  );

revoke all on table public.buyer_procurement_requests from public, anon, authenticated;
revoke all on table public.buyer_procurement_request_lines from public, anon, authenticated;
revoke all on table private.platform_supplier_suborders from public, anon, authenticated;
revoke all on table private.platform_supplier_suborder_lines from public, anon, authenticated;
grant select (
  id, organization_id, draft_cart_id, buyer_location_id, seller_type,
  request_status, source_list_name, submitted_by, submitted_at
) on table public.buyer_procurement_requests to authenticated;
grant select (
  id, organization_id, request_id, catalog_offer_id, quantity, title,
  sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit,
  price_amount, currency, availability, catalog_offer_version,
  price_observed_at, availability_observed_at, created_at
) on table public.buyer_procurement_request_lines to authenticated;

-- All buyer cart mutations now serialize on the parent cart row. This gives the
-- submit worker and edits one lock order and makes the freeze race-safe.
drop policy buyer_draft_carts_delete on public.buyer_draft_carts;
create policy buyer_draft_carts_delete
  on public.buyer_draft_carts for delete to authenticated
  using (
    submitted_at is null
    and private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_carts.organization_id
        and organization.organization_type = 'buyer'
    )
  );

drop policy buyer_draft_carts_update_location on public.buyer_draft_carts;
create policy buyer_draft_carts_update_location
  on public.buyer_draft_carts for update to authenticated
  using (
    submitted_at is null
    and private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_carts.organization_id
        and organization.organization_type = 'buyer'
    )
  )
  with check (
    submitted_at is null
    and private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_carts.organization_id
        and organization.organization_type = 'buyer'
    )
  );

drop policy buyer_draft_cart_items_update on public.buyer_draft_cart_items;
create policy buyer_draft_cart_items_update
  on public.buyer_draft_cart_items for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_cart_items.organization_id
        and organization.organization_type = 'buyer'
    )
    and exists (
      select 1 from public.buyer_draft_carts as cart
      where cart.organization_id = buyer_draft_cart_items.organization_id
        and cart.id = buyer_draft_cart_items.cart_id
        and cart.submitted_at is null
    )
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_cart_items.organization_id
        and organization.organization_type = 'buyer'
    )
    and exists (
      select 1 from public.buyer_draft_carts as cart
      where cart.organization_id = buyer_draft_cart_items.organization_id
        and cart.id = buyer_draft_cart_items.cart_id
        and cart.submitted_at is null
    )
  );

drop policy buyer_draft_cart_items_delete on public.buyer_draft_cart_items;
create policy buyer_draft_cart_items_delete
  on public.buyer_draft_cart_items for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_cart_items.organization_id
        and organization.organization_type = 'buyer'
    )
    and exists (
      select 1 from public.buyer_draft_carts as cart
      where cart.organization_id = buyer_draft_cart_items.organization_id
        and cart.id = buyer_draft_cart_items.cart_id
        and cart.submitted_at is null
    )
  );

create or replace function private.guard_buyer_draft_cart_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.submitted_at is not null then
      raise exception using errcode = '55000', message = 'submitted draft cart is frozen';
    end if;
    return old;
  end if;

  if old.submitted_at is not null then
    raise exception using errcode = '55000', message = 'submitted draft cart is frozen';
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.source_list_name is distinct from old.source_list_name
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'draft cart identity is immutable';
  end if;

  if new.submitted_at is distinct from old.submitted_at
     and (
       new.submitted_at is null
       or current_setting('app.platform_procurement_request_cart_id', true) is distinct from old.id::text
     ) then
    raise exception using errcode = '42501', message = 'draft cart submission is worker-only';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_buyer_draft_cart_submission() from public, anon, authenticated;
create trigger buyer_draft_carts_guard_submission
  before update or delete on public.buyer_draft_carts
  for each row execute function private.guard_buyer_draft_cart_submission();

create or replace function private.guard_buyer_draft_cart_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted_at timestamptz;
begin
  select cart.submitted_at
    into v_submitted_at
    from public.buyer_draft_carts as cart
   where cart.organization_id = old.organization_id
     and cart.id = old.cart_id;

  if v_submitted_at is not null then
    raise exception using errcode = '55000', message = 'submitted draft cart is frozen';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.cart_id is distinct from old.cart_id
       or new.catalog_offer_id is distinct from old.catalog_offer_id
       or new.catalog_offer_version is distinct from old.catalog_offer_version
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'draft cart item identity is immutable';
    end if;
    return new;
  end if;

  return old;
end;
$$;
revoke all on function private.guard_buyer_draft_cart_item_mutation() from public, anon, authenticated;
create trigger buyer_draft_cart_items_guard_submission
  before update or delete on public.buyer_draft_cart_items
  for each row execute function private.guard_buyer_draft_cart_item_mutation();

create or replace function private.update_buyer_draft_cart_item_quantity(
  p_organization_id uuid,
  p_item_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
  v_cart public.buyer_draft_carts%rowtype;
  v_item_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_org_role(p_organization_id, array['owner', 'admin', 'buyer']::text[])
     or not exists (
       select 1 from public.organizations as organization
       where organization.id = p_organization_id and organization.organization_type = 'buyer'
     ) then
    raise exception using errcode = '42501', message = 'buyer membership required';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception using errcode = '23514', message = 'quantity is outside the allowed range';
  end if;

  select item.cart_id into v_cart_id
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id and item.id = p_item_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart item not found';
  end if;

  select cart.* into v_cart
    from public.buyer_draft_carts as cart
   where cart.organization_id = p_organization_id and cart.id = v_cart_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart not found';
  end if;
  if v_cart.submitted_at is not null then
    raise exception using errcode = '55000', message = 'submitted draft cart is frozen';
  end if;

  select item.id into v_item_id
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id
     and item.cart_id = v_cart_id
     and item.id = p_item_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart item not found';
  end if;

  update public.buyer_draft_cart_items as item
     set quantity = p_quantity
   where item.organization_id = p_organization_id and item.id = v_item_id;
  return v_item_id;
end;
$$;
revoke all on function private.update_buyer_draft_cart_item_quantity(uuid, uuid, integer) from public, anon;
grant execute on function private.update_buyer_draft_cart_item_quantity(uuid, uuid, integer) to authenticated;

create or replace function public.update_buyer_draft_cart_item_quantity(
  p_organization_id uuid,
  p_item_id uuid,
  p_quantity integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.update_buyer_draft_cart_item_quantity(p_organization_id, p_item_id, p_quantity);
$$;
revoke all on function public.update_buyer_draft_cart_item_quantity(uuid, uuid, integer) from public, anon;
grant execute on function public.update_buyer_draft_cart_item_quantity(uuid, uuid, integer) to authenticated;

create or replace function private.delete_buyer_draft_cart_item(
  p_organization_id uuid,
  p_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
  v_cart public.buyer_draft_carts%rowtype;
  v_deleted_count integer;
begin
  if (select auth.uid()) is null
     or not private.has_org_role(p_organization_id, array['owner', 'admin', 'buyer']::text[])
     or not exists (
       select 1 from public.organizations as organization
       where organization.id = p_organization_id and organization.organization_type = 'buyer'
     ) then
    raise exception using errcode = '42501', message = 'buyer membership required';
  end if;

  select item.cart_id into v_cart_id
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id and item.id = p_item_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart item not found';
  end if;

  select cart.* into v_cart
    from public.buyer_draft_carts as cart
   where cart.organization_id = p_organization_id and cart.id = v_cart_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart not found';
  end if;
  if v_cart.submitted_at is not null then
    raise exception using errcode = '55000', message = 'submitted draft cart is frozen';
  end if;

  delete from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id
     and item.cart_id = v_cart_id
     and item.id = p_item_id;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'draft cart item not found';
  end if;
  return true;
end;
$$;
revoke all on function private.delete_buyer_draft_cart_item(uuid, uuid) from public, anon;
grant execute on function private.delete_buyer_draft_cart_item(uuid, uuid) to authenticated;

create or replace function public.delete_buyer_draft_cart_item(
  p_organization_id uuid,
  p_item_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_buyer_draft_cart_item(p_organization_id, p_item_id);
$$;
revoke all on function public.delete_buyer_draft_cart_item(uuid, uuid) from public, anon;
grant execute on function public.delete_buyer_draft_cart_item(uuid, uuid) to authenticated;

-- Direct item UPDATE/DELETE would acquire the line row before its parent, which
-- could race submission. Only the parent-locking RPCs may now mutate cart lines.
revoke update (quantity), delete on table public.buyer_draft_cart_items from public, anon, authenticated;
grant select on table public.buyer_draft_cart_items to authenticated;

create or replace function private.create_buyer_procurement_request(
  p_organization_id uuid,
  p_cart_id uuid,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.buyer_draft_carts%rowtype;
  v_existing public.buyer_procurement_requests%rowtype;
  v_payload jsonb;
  v_fingerprint text;
  v_now timestamptz;
  v_item_count integer;
  v_blocked_count integer;
  v_inserted_count integer;
  v_request_id uuid;
begin
  if (select auth.uid()) is null
     or not private.has_org_role(p_organization_id, array['owner', 'admin', 'buyer']::text[])
     or not exists (
       select 1 from public.organizations as organization
       where organization.id = p_organization_id and organization.organization_type = 'buyer'
     ) then
    raise exception using errcode = '42501', message = 'buyer membership required';
  end if;
  if p_cart_id is null or p_idempotency_key is null then
    raise exception using errcode = '23514', message = 'cart and idempotency key are required';
  end if;

  -- Lock parent first, then cart lines, then offer/profile rows in stable ID order.
  select cart.* into v_cart
    from public.buyer_draft_carts as cart
   where cart.organization_id = p_organization_id and cart.id = p_cart_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'draft cart not found';
  end if;

  select pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'cart_id', v_cart.id,
    'buyer_location_id', v_cart.buyer_location_id,
    'items', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'item_id', item.id,
          'catalog_offer_id', item.catalog_offer_id,
          'quantity', item.quantity,
          'catalog_offer_version', item.catalog_offer_version
        ) order by item.id
      ),
      '[]'::jsonb
    )
  )
    into v_payload
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id and item.cart_id = p_cart_id;
  v_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')),
    'hex'
  );

  select request.* into v_existing
    from public.buyer_procurement_requests as request
   where request.organization_id = p_organization_id
     and request.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.draft_cart_id is distinct from p_cart_id
       or v_existing.payload_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency key conflict';
    end if;
    return v_existing.id;
  end if;

  if exists (
    select 1 from public.buyer_procurement_requests as request
    where request.organization_id = p_organization_id and request.draft_cart_id = p_cart_id
  ) or v_cart.submitted_at is not null then
    raise exception using errcode = '55000', message = 'draft cart already submitted and frozen';
  end if;
  if v_cart.buyer_location_id is null then
    raise exception using errcode = '23514', message = 'select a buyer location before submitting';
  end if;

  perform item.id
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id and item.cart_id = p_cart_id
   order by item.id
   for update;
  select count(*)::integer into v_item_count
    from public.buyer_draft_cart_items as item
   where item.organization_id = p_organization_id and item.cart_id = p_cart_id;
  if v_item_count = 0 then
    raise exception using errcode = '23514', message = 'cannot submit an empty draft cart';
  end if;

  perform offer.id
    from public.catalog_offers as offer
   where offer.id in (
     select item.catalog_offer_id
       from public.buyer_draft_cart_items as item
      where item.organization_id = p_organization_id and item.cart_id = p_cart_id
   )
   order by offer.id
   for update;

  perform profile.organization_id
    from public.supplier_profiles as profile
   where profile.organization_id in (
     select offer.supplier_organization_id
       from public.buyer_draft_cart_items as item
       join public.catalog_offers as offer on offer.id = item.catalog_offer_id
      where item.organization_id = p_organization_id and item.cart_id = p_cart_id
   )
   order by profile.organization_id
   for share;

  v_now := clock_timestamp();
  select count(*) filter (
           where offer.id is null
              or not offer.is_published
              or profile.verification_status is distinct from 'approved'
              or offer.version is distinct from item.catalog_offer_version
              or offer.price_amount is null
              or offer.currency is null
              or offer.price_observed_at > v_now
              or offer.price_observed_at < v_now - interval '24 hours'
              or (offer.price_valid_until is not null and offer.price_valid_until <= v_now)
              or offer.availability is distinct from 'in_stock'
              or offer.availability_observed_at > v_now
              or offer.availability_observed_at < v_now - interval '24 hours'
              or item.quantity < offer.moq
              or item.quantity % offer.order_step <> 0
         )::integer
    into v_blocked_count
    from public.buyer_draft_cart_items as item
    left join public.catalog_offers as offer on offer.id = item.catalog_offer_id
    left join public.supplier_profiles as profile
      on profile.organization_id = offer.supplier_organization_id
   where item.organization_id = p_organization_id and item.cart_id = p_cart_id;
  if v_blocked_count > 0 then
    raise exception using
      errcode = '40001',
      message = 'catalog terms changed or are not current; review the draft cart again';
  end if;

  insert into public.buyer_procurement_requests (
    organization_id, draft_cart_id, buyer_location_id, source_list_name,
    idempotency_key, payload_fingerprint, submitted_by, submitted_at
  ) values (
    p_organization_id, p_cart_id, v_cart.buyer_location_id, v_cart.source_list_name,
    p_idempotency_key, v_fingerprint, auth.uid(), v_now
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select request.* into v_existing
      from public.buyer_procurement_requests as request
     where request.organization_id = p_organization_id
       and request.idempotency_key = p_idempotency_key;
    if not found
       or v_existing.draft_cart_id is distinct from p_cart_id
       or v_existing.payload_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency key conflict';
    end if;
    return v_existing.id;
  end if;

  insert into public.buyer_procurement_request_lines (
    organization_id, request_id, catalog_offer_id, quantity, title,
    sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit,
    price_amount, currency, availability, catalog_offer_version,
    price_observed_at, availability_observed_at
  )
  select
    item.organization_id, v_request_id, offer.id, item.quantity, offer.title,
    offer.sell_unit_label, offer.units_per_sell_unit, offer.pack_amount,
    offer.pack_base_unit, offer.price_amount, offer.currency, offer.availability,
    offer.version, offer.price_observed_at, offer.availability_observed_at
  from public.buyer_draft_cart_items as item
  join public.catalog_offers as offer on offer.id = item.catalog_offer_id
  where item.organization_id = p_organization_id and item.cart_id = p_cart_id;
  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_item_count then
    raise exception using errcode = '40001', message = 'catalog changed during request creation';
  end if;

  insert into private.platform_supplier_suborders (
    organization_id, buyer_request_id, supplier_organization_id
  )
  select distinct p_organization_id, v_request_id, offer.supplier_organization_id
    from public.buyer_draft_cart_items as item
    join public.catalog_offers as offer on offer.id = item.catalog_offer_id
   where item.organization_id = p_organization_id and item.cart_id = p_cart_id
   order by offer.supplier_organization_id;

  insert into private.platform_supplier_suborder_lines (
    organization_id, buyer_request_id, supplier_suborder_id,
    supplier_organization_id, buyer_request_line_id, catalog_offer_id, quantity
  )
  select
    p_organization_id, v_request_id, suborder.id,
    offer.supplier_organization_id, request_line.id, offer.id, item.quantity
  from public.buyer_draft_cart_items as item
  join public.catalog_offers as offer on offer.id = item.catalog_offer_id
  join public.buyer_procurement_request_lines as request_line
    on request_line.organization_id = p_organization_id
   and request_line.request_id = v_request_id
   and request_line.catalog_offer_id = offer.id
  join private.platform_supplier_suborders as suborder
    on suborder.organization_id = p_organization_id
   and suborder.buyer_request_id = v_request_id
   and suborder.supplier_organization_id = offer.supplier_organization_id
  where item.organization_id = p_organization_id and item.cart_id = p_cart_id;

  perform pg_catalog.set_config('app.platform_procurement_request_cart_id', p_cart_id::text, true);
  update public.buyer_draft_carts as cart
     set submitted_at = v_now
   where cart.organization_id = p_organization_id
     and cart.id = p_cart_id
     and cart.submitted_at is null;
  get diagnostics v_inserted_count = row_count;
  perform pg_catalog.set_config('app.platform_procurement_request_cart_id', '', true);
  if v_inserted_count <> 1 then
    raise exception using errcode = '55000', message = 'draft cart could not be frozen';
  end if;

  return v_request_id;
end;
$$;
revoke all on function private.create_buyer_procurement_request(uuid, uuid, uuid) from public, anon;
grant execute on function private.create_buyer_procurement_request(uuid, uuid, uuid) to authenticated;

create or replace function public.create_buyer_procurement_request(
  p_organization_id uuid,
  p_cart_id uuid,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_buyer_procurement_request(
    p_organization_id, p_cart_id, p_idempotency_key
  );
$$;
revoke all on function public.create_buyer_procurement_request(uuid, uuid, uuid) from public, anon;
grant execute on function public.create_buyer_procurement_request(uuid, uuid, uuid) to authenticated;

comment on table public.buyer_procurement_requests is
  'Buyer-facing, explicitly submitted platform-seller procurement requests. Submitted is a request state only; it is not supplier acceptance, an invoice, payment, or a delivery commitment.';
comment on table public.buyer_procurement_request_lines is
  'Buyer-visible immutable snapshots of catalog terms revalidated at request submission; displayed prices are not a charge or invoice.';
comment on table private.platform_supplier_suborders is
  'Internal platform routing records grouped by supplier; private only, no supplier access, dispatch, acceptance, invoice, or payment is implemented.';
comment on table private.platform_supplier_suborder_lines is
  'Internal supplier fulfillment line links for a platform request; private only and not sent to suppliers.';
comment on function private.create_buyer_procurement_request(uuid, uuid, uuid) is
  'Atomically rechecks a buyer draft and current catalog observations, creates the platform-seller request and private supplier suborders, then freezes the draft. The RPC never charges, invoices, dispatches, or notifies.';
comment on function public.create_buyer_procurement_request(uuid, uuid, uuid) is
  'SECURITY INVOKER RPC for a buyer manager to explicitly create an idempotent platform-seller procurement request from a ready draft cart.';
comment on function public.update_buyer_draft_cart_item_quantity(uuid, uuid, integer) is
  'Buyer-manager-only quantity edit that locks the parent draft cart before the line, and refuses submitted carts.';
comment on function public.delete_buyer_draft_cart_item(uuid, uuid) is
  'Buyer-manager-only line removal that locks the parent draft cart before the line, and refuses submitted carts.';
comment on column public.buyer_draft_carts.submitted_at is
  'Non-null once this draft has been atomically converted into a buyer procurement request; submitted drafts cannot be edited or deleted.';

-- Explicit indexes support every foreign-key lookup and tenant-scoped request view.
create index buyer_procurement_requests_org_location_idx
  on public.buyer_procurement_requests (organization_id, buyer_location_id);
create index buyer_procurement_requests_submitted_by_idx
  on public.buyer_procurement_requests (submitted_by);
create index buyer_procurement_request_lines_offer_idx
  on public.buyer_procurement_request_lines (catalog_offer_id);
create index platform_supplier_suborder_lines_suborder_fk_idx
  on private.platform_supplier_suborder_lines
    (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id);
create index platform_supplier_suborder_lines_request_line_fk_idx
  on private.platform_supplier_suborder_lines
    (organization_id, buyer_request_id, buyer_request_line_id);
