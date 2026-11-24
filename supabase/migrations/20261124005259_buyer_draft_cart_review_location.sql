-- Persist the buyer's explicit delivery-location choice on a draft cart.
-- A location is never inferred; the composite FK prevents cross-tenant references.

alter table public.buyer_locations
  add constraint buyer_locations_organization_id_id_key unique (organization_id, id);

alter table public.buyer_draft_carts
  add column buyer_location_id uuid;

alter table public.buyer_draft_carts
  add constraint buyer_draft_carts_location_same_org_fk
  foreign key (organization_id, buyer_location_id)
  references public.buyer_locations (organization_id, id)
  on delete restrict;

create index buyer_draft_carts_org_location_idx
  on public.buyer_draft_carts (organization_id, buyer_location_id)
  where buyer_location_id is not null;

create policy buyer_draft_carts_update_location
  on public.buyer_draft_carts for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_carts.organization_id
        and organization.organization_type = 'buyer'
    )
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'buyer']::text[])
    and exists (
      select 1 from public.organizations as organization
      where organization.id = buyer_draft_carts.organization_id
        and organization.organization_type = 'buyer'
    )
  );

revoke update on table public.buyer_draft_carts from public, anon, authenticated;
grant update (buyer_location_id) on table public.buyer_draft_carts to authenticated;

comment on column public.buyer_draft_carts.buyer_location_id is
  'Explicit buyer-owned delivery location chosen for review; this does not confirm supplier coverage or create an order.';
