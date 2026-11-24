-- Persistent buyer draft carts copied atomically from saved lists. These are not orders.

create table public.buyer_draft_carts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_list_name text not null check (char_length(btrim(source_list_name)) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.buyer_draft_cart_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cart_id uuid not null,
  catalog_offer_id uuid not null references public.catalog_offers (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 1000000),
  catalog_offer_version integer not null check (catalog_offer_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_draft_cart_items_cart_tenant_fk
    foreign key (organization_id, cart_id)
    references public.buyer_draft_carts (organization_id, id) on delete cascade,
  constraint buyer_draft_cart_items_cart_offer_key unique (cart_id, catalog_offer_id)
);

create index buyer_draft_carts_org_idx
  on public.buyer_draft_carts (organization_id, created_at desc);
create index buyer_draft_cart_items_org_cart_idx
  on public.buyer_draft_cart_items (organization_id, cart_id);

-- Keep the cart's offer reference honest and record the catalog version at copy time.
-- A later offer edit leaves this version unchanged so the UI can require a recheck.
create or replace function private.validate_buyer_draft_cart_item_offer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.catalog_offers as offer
    where offer.id = new.catalog_offer_id
      and offer.version = new.catalog_offer_version
      and offer.is_published
      and private.is_approved_supplier(offer.supplier_organization_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'draft cart offer must be current, published, and supplied by an approved supplier';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_buyer_draft_cart_item_offer() from public, anon, authenticated;
create trigger buyer_draft_cart_items_validate_offer
  before insert or update of catalog_offer_id, catalog_offer_version on public.buyer_draft_cart_items
  for each row execute function private.validate_buyer_draft_cart_item_offer();

create trigger buyer_draft_cart_items_touch_before_update
  before update on public.buyer_draft_cart_items
  for each row execute function private.touch_buyer_procurement_row();

alter table public.buyer_draft_carts enable row level security;
alter table public.buyer_draft_cart_items enable row level security;

create policy buyer_draft_carts_select
  on public.buyer_draft_carts for select to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer', 'viewer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_draft_carts_delete
  on public.buyer_draft_carts for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );

create policy buyer_draft_cart_items_select
  on public.buyer_draft_cart_items for select to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer', 'viewer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_draft_cart_items_update
  on public.buyer_draft_cart_items for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_draft_cart_items_delete
  on public.buyer_draft_cart_items for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );

revoke all on table public.buyer_draft_carts from public, anon, authenticated;
revoke all on table public.buyer_draft_cart_items from public, anon, authenticated;
grant select, delete on table public.buyer_draft_carts to authenticated;
grant select, delete on table public.buyer_draft_cart_items to authenticated;
grant update (quantity) on table public.buyer_draft_cart_items to authenticated;

-- The non-exposed worker bypasses table RLS only after checking the caller's
-- authenticated buyer membership. Clients have no direct INSERT grants.
create or replace function private.create_buyer_draft_cart(
  p_organization_id uuid,
  p_source_list_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_list_name text;
  v_expected_count integer;
  v_inserted_count integer;
  v_cart_id uuid;
begin
  if auth.uid() is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin', 'buyer']::text[]
  ) or not exists (
    select 1 from public.organizations as organization
    where organization.id = p_organization_id and organization.organization_type = 'buyer'
  ) then
    raise exception using errcode = '42501', message = 'buyer membership required';
  end if;

  select procurement_list.name
    into v_source_list_name
    from public.buyer_procurement_lists as procurement_list
   where procurement_list.organization_id = p_organization_id
     and procurement_list.id = p_source_list_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'procurement list not found';
  end if;

  select count(*)::integer
    into v_expected_count
    from public.buyer_procurement_list_items as list_item
   where list_item.organization_id = p_organization_id
     and list_item.list_id = p_source_list_id;
  if v_expected_count = 0 then
    raise exception using errcode = '23514', message = 'cannot create a draft cart from an empty list';
  end if;

  insert into public.buyer_draft_carts (organization_id, source_list_name)
  values (p_organization_id, v_source_list_name)
  returning id into v_cart_id;

  insert into public.buyer_draft_cart_items (
    organization_id,
    cart_id,
    catalog_offer_id,
    quantity,
    catalog_offer_version
  )
  select
    list_item.organization_id,
    v_cart_id,
    list_item.catalog_offer_id,
    list_item.quantity,
    offer.version
  from public.buyer_procurement_list_items as list_item
  join public.catalog_offers as offer on offer.id = list_item.catalog_offer_id
  where list_item.organization_id = p_organization_id
    and list_item.list_id = p_source_list_id
    and offer.is_published
    and private.is_approved_supplier(offer.supplier_organization_id);

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'one or more offers are no longer available';
  end if;

  return v_cart_id;
end;
$$;
grant usage on schema private to authenticated;
revoke all on function private.create_buyer_draft_cart(uuid, uuid) from public, anon;
grant execute on function private.create_buyer_draft_cart(uuid, uuid) to authenticated;

-- PostgREST exposes this SECURITY INVOKER wrapper from public; all privilege
-- elevation and explicit membership checks remain in the private worker.
create or replace function public.create_buyer_draft_cart(
  p_organization_id uuid,
  p_source_list_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_buyer_draft_cart(p_organization_id, p_source_list_id);
$$;
revoke all on function public.create_buyer_draft_cart(uuid, uuid) from public, anon;
grant execute on function public.create_buyer_draft_cart(uuid, uuid) to authenticated;

comment on table public.buyer_draft_carts is
  'Tenant-scoped editable buyer draft carts; never an order, payment, or supplier commitment.';
comment on table public.buyer_draft_cart_items is
  'Draft quantities and catalog version at copy time; price and availability must be rechecked before any future order flow.';
comment on function private.create_buyer_draft_cart(uuid, uuid) is
  'Atomically copies a non-empty saved buyer procurement list into a new draft cart after checking caller membership; does not submit or create an order.';
comment on function public.create_buyer_draft_cart(uuid, uuid) is
  'SECURITY INVOKER PostgREST wrapper for the private atomic buyer draft-cart copy function.';
