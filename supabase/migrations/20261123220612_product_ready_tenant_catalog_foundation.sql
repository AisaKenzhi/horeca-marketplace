-- Product Ready foundation: authenticated tenants, buyer locations and a minimal supplier catalog.
-- No service-role access is exposed to the browser. Every API grant below is paired with RLS.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  organization_type text not null check (organization_type in ('buyer', 'supplier')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (
    role in (
      'owner', 'admin', 'buyer', 'viewer', 'receiver',
      'catalog_operator', 'order_operator'
    )
  ),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.buyer_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  delivery_zone text check (delivery_zone is null or char_length(btrim(delivery_zone)) <= 120),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.supplier_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.catalog_offers (
  id uuid primary key default gen_random_uuid(),
  supplier_organization_id uuid not null references public.supplier_profiles (organization_id) on delete cascade,
  supplier_sku text not null check (char_length(btrim(supplier_sku)) between 1 and 80),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  sell_unit_label text not null check (char_length(btrim(sell_unit_label)) between 1 and 120),
  units_per_sell_unit integer not null check (units_per_sell_unit > 0),
  pack_amount numeric(12, 3) not null check (pack_amount > 0),
  pack_base_unit text not null check (pack_base_unit in ('kg', 'l', 'piece')),
  price_amount numeric(16, 4) check (price_amount is null or price_amount > 0),
  currency text,
  moq integer not null check (moq > 0),
  order_step integer not null check (order_step > 0),
  availability text not null default 'unknown'
    check (availability in ('in_stock', 'low_stock', 'out_of_stock', 'on_request', 'unknown')),
  price_valid_until timestamptz,
  is_published boolean not null default false,
  price_observed_at timestamptz not null default now(),
  availability_observed_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_organization_id, supplier_sku),
  check (
    (price_amount is null and currency is null)
    or (price_amount is not null and currency ~ '^[A-Z]{3}$')
  )
);

create index organization_memberships_user_org_idx
  on public.organization_memberships (user_id, organization_id);
create index buyer_locations_organization_idx
  on public.buyer_locations (organization_id);
create index catalog_offers_published_idx
  on public.catalog_offers (is_published, title)
  where is_published;
create index catalog_offers_supplier_idx
  on public.catalog_offers (supplier_organization_id, created_at desc);

-- This SECURITY DEFINER routine is internal to an INSERT trigger only. It binds
-- the creator to the new organization in the same transaction as the organization
-- row. Client roles cannot execute it or insert/update membership rows directly.
create or replace function private.add_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from (select auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'organization creator must be the authenticated user';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  return new;
end;
$$;

revoke all on function private.add_organization_owner() from public, anon, authenticated;
create trigger organizations_add_creator_membership
  after insert on public.organizations
  for each row execute function private.add_organization_owner();

-- Invoker-only helper. Membership RLS exposes only the caller's own rows, so
-- this avoids copying role claims into editable user metadata or JWT claims.
create or replace function private.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships as membership
    where membership.organization_id = p_org_id
      and membership.user_id = (select auth.uid())
      and membership.role = any (p_roles)
  );
$$;

revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;

-- This narrowly scoped definer helper reads only the supplier approval bit. It
-- avoids RLS recursion between published offers and supplier profile visibility.
create or replace function private.is_approved_supplier(p_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  return exists (
    select 1
    from public.supplier_profiles as profile
    where profile.organization_id = p_organization_id
      and profile.verification_status = 'approved'
  );
end;
$$;

revoke all on function private.is_approved_supplier(uuid) from public, anon;
grant execute on function private.is_approved_supplier(uuid) to authenticated;

-- Internal timestamp/version maintenance for catalog edits. Clients cannot
-- write these fields; observations move only when the corresponding value does.
create or replace function private.touch_catalog_offer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.price_amount is distinct from old.price_amount
     or new.currency is distinct from old.currency then
    new.price_observed_at := clock_timestamp();
  else
    new.price_observed_at := old.price_observed_at;
  end if;

  if new.availability is distinct from old.availability then
    new.availability_observed_at := clock_timestamp();
  else
    new.availability_observed_at := old.availability_observed_at;
  end if;

  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.touch_catalog_offer() from public, anon, authenticated;
create trigger catalog_offers_touch_before_update
  before update on public.catalog_offers
  for each row execute function private.touch_catalog_offer();

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.buyer_locations enable row level security;
alter table public.supplier_profiles enable row level security;
alter table public.catalog_offers enable row level security;

create policy organizations_select_member
  on public.organizations for select to authenticated
  using (
    private.has_org_role(
      id,
      array['owner', 'admin', 'buyer', 'viewer', 'receiver', 'catalog_operator', 'order_operator']::text[]
    )
  );

create policy organizations_insert_self
  on public.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy memberships_select_self
  on public.organization_memberships for select to authenticated
  using (user_id = (select auth.uid()));

create policy buyer_locations_select_member
  on public.buyer_locations for select to authenticated
  using (
    private.has_org_role(
      organization_id,
      array['owner', 'admin', 'buyer', 'viewer', 'receiver']::text[]
    )
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = organization_id
        and organization.organization_type = 'buyer'
    )
  );

create policy buyer_locations_insert_manager
  on public.buyer_locations for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin']::text[])
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = organization_id
        and organization.organization_type = 'buyer'
    )
  );

create policy buyer_locations_update_manager
  on public.buyer_locations for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::text[]))
  with check (
    private.has_org_role(organization_id, array['owner', 'admin']::text[])
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = organization_id
        and organization.organization_type = 'buyer'
    )
  );

create policy buyer_locations_delete_manager
  on public.buyer_locations for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::text[]));

create policy supplier_profiles_select_member_or_listed
  on public.supplier_profiles for select to authenticated
  using (
    private.has_org_role(
      organization_id,
      array['owner', 'admin', 'catalog_operator', 'order_operator']::text[]
    )
    or exists (
      select 1
      from public.catalog_offers as offer
      where offer.supplier_organization_id = organization_id
        and offer.is_published
        and private.is_approved_supplier(organization_id)
    )
  );

create policy supplier_profiles_insert_pending
  on public.supplier_profiles for insert to authenticated
  with check (
    verification_status = 'pending'
    and private.has_org_role(organization_id, array['owner', 'admin']::text[])
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = organization_id
        and organization.organization_type = 'supplier'
    )
  );

create policy supplier_profiles_update_member
  on public.supplier_profiles for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::text[]))
  with check (private.has_org_role(organization_id, array['owner', 'admin']::text[]));

create policy catalog_offers_select_published_or_supplier_member
  on public.catalog_offers for select to authenticated
  using (
    (is_published and private.is_approved_supplier(supplier_organization_id))
    or private.has_org_role(
      supplier_organization_id,
      array['owner', 'admin', 'catalog_operator', 'order_operator']::text[]
    )
  );

create policy catalog_offers_insert_catalog_operator
  on public.catalog_offers for insert to authenticated
  with check (
    private.has_org_role(
      supplier_organization_id,
      array['owner', 'admin', 'catalog_operator']::text[]
    )
    and not is_published
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = supplier_organization_id
        and organization.organization_type = 'supplier'
    )
  );

create policy catalog_offers_update_catalog_operator
  on public.catalog_offers for update to authenticated
  using (
    private.is_approved_supplier(supplier_organization_id)
    and private.has_org_role(
      supplier_organization_id,
      array['owner', 'admin', 'catalog_operator']::text[]
    )
  )
  with check (
    private.is_approved_supplier(supplier_organization_id)
    and private.has_org_role(
      supplier_organization_id,
      array['owner', 'admin', 'catalog_operator']::text[]
    )
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = supplier_organization_id
        and organization.organization_type = 'supplier'
    )
  );

-- No anonymous data access. Column-level writes prevent clients from assigning
-- ids, creator ids, membership roles, tenant ids or observed timestamps.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.organization_memberships from anon, authenticated;
revoke all on table public.buyer_locations from anon, authenticated;
revoke all on table public.supplier_profiles from anon, authenticated;
revoke all on table public.catalog_offers from anon, authenticated;

grant select on table public.organizations to authenticated;
grant insert (name, organization_type, created_by) on table public.organizations to authenticated;

grant select on table public.organization_memberships to authenticated;

grant select, delete on table public.buyer_locations to authenticated;
grant insert (organization_id, name, address, delivery_zone) on table public.buyer_locations to authenticated;
grant update (name, address, delivery_zone) on table public.buyer_locations to authenticated;

grant select on table public.supplier_profiles to authenticated;
grant insert (organization_id, display_name) on table public.supplier_profiles to authenticated;
grant update (display_name) on table public.supplier_profiles to authenticated;

grant select on table public.catalog_offers to authenticated;
grant insert (
  supplier_organization_id, supplier_sku, title, category, sell_unit_label,
  units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency,
  moq, order_step, availability, price_valid_until, is_published
) on table public.catalog_offers to authenticated;
grant update (is_published) on table public.catalog_offers to authenticated;

comment on table public.organizations is
  'Tenant organizations. The creator receives an owner membership through a transaction-scoped trigger.';
comment on table public.organization_memberships is
  'Trusted organization membership and role records. Client roles can read only their own rows.';
comment on table public.buyer_locations is
  'Buyer delivery locations; address data is visible only to authorized members of that buyer tenant.';
comment on table public.supplier_profiles is
  'Supplier identity with pending-by-default review status; status is not self-assignable through the client API.';
comment on table public.catalog_offers is
  'Supplier-owned catalog SKUs. Published rows are shared only with authenticated users; this is not a public storefront.';
