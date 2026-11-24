-- Persistent buyer procurement lists. These are saved selections only, not orders.

create table public.buyer_procurement_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.buyer_procurement_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  list_id uuid not null,
  catalog_offer_id uuid not null references public.catalog_offers (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_procurement_list_items_list_tenant_fk
    foreign key (organization_id, list_id)
    references public.buyer_procurement_lists (organization_id, id) on delete cascade,
  constraint buyer_procurement_list_items_list_offer_key unique (list_id, catalog_offer_id)
);

create index buyer_procurement_lists_org_idx
  on public.buyer_procurement_lists (organization_id, created_at desc);
create index buyer_procurement_list_items_org_list_idx
  on public.buyer_procurement_list_items (organization_id, list_id);

-- Offers can be referenced only while currently published and supplied by an
-- approved supplier. No price, currency, market, or orderability assumptions.
-- SECURITY INVOKER preserves RLS and uses only the caller's allowed catalog view.
create or replace function private.validate_buyer_procurement_list_item_offer()
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
      and offer.is_published
      and private.is_approved_supplier(offer.supplier_organization_id)
  ) then
    raise exception using
      errcode = '23514',
      message = 'catalog offer must be published by an approved supplier';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_buyer_procurement_list_item_offer() from public, anon, authenticated;
create trigger buyer_procurement_list_items_validate_offer
  before insert or update of catalog_offer_id on public.buyer_procurement_list_items
  for each row execute function private.validate_buyer_procurement_list_item_offer();

create or replace function private.touch_buyer_procurement_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.touch_buyer_procurement_row() from public, anon, authenticated;
create trigger buyer_procurement_lists_touch_before_update
  before update on public.buyer_procurement_lists
  for each row execute function private.touch_buyer_procurement_row();
create trigger buyer_procurement_list_items_touch_before_update
  before update on public.buyer_procurement_list_items
  for each row execute function private.touch_buyer_procurement_row();

alter table public.buyer_procurement_lists enable row level security;
alter table public.buyer_procurement_list_items enable row level security;

create policy buyer_procurement_lists_select
  on public.buyer_procurement_lists for select to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer', 'viewer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_procurement_lists_insert
  on public.buyer_procurement_lists for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_procurement_lists_update
  on public.buyer_procurement_lists for update to authenticated
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
create policy buyer_procurement_lists_delete
  on public.buyer_procurement_lists for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );

create policy buyer_procurement_list_items_select
  on public.buyer_procurement_list_items for select to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer', 'viewer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_procurement_list_items_insert
  on public.buyer_procurement_list_items for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );
create policy buyer_procurement_list_items_update
  on public.buyer_procurement_list_items for update to authenticated
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
create policy buyer_procurement_list_items_delete
  on public.buyer_procurement_list_items for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = organization_id and organization.organization_type = 'buyer'
    )
  );

revoke all on table public.buyer_procurement_lists from public, anon, authenticated;
revoke all on table public.buyer_procurement_list_items from public, anon, authenticated;
grant select, delete on table public.buyer_procurement_lists to authenticated;
grant insert (organization_id, name) on table public.buyer_procurement_lists to authenticated;
grant update (name) on table public.buyer_procurement_lists to authenticated;
grant select, delete on table public.buyer_procurement_list_items to authenticated;
grant insert (organization_id, list_id, catalog_offer_id, quantity)
  on table public.buyer_procurement_list_items to authenticated;
grant update (quantity) on table public.buyer_procurement_list_items to authenticated;

comment on table public.buyer_procurement_lists is
  'Tenant-scoped saved buyer procurement lists; not a checkout, order, or payment.';
comment on table public.buyer_procurement_list_items is
  'Offer selections and positive quantities saved on a buyer procurement list.';
