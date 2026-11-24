-- Preserve the buyer-facing location details as part of each immutable request.
-- Existing submitted requests are backfilled from their still-referenced location.

alter table public.buyer_procurement_requests
  add column buyer_location_name text,
  add column buyer_location_address text,
  add column buyer_location_delivery_zone text;

-- The request table already rejects UPDATE/DELETE. Disable that guard only for
-- this transactional backfill, then restore it before enforcing NOT NULL.
alter table public.buyer_procurement_requests
  disable trigger buyer_procurement_requests_immutable;

update public.buyer_procurement_requests as request
   set buyer_location_name = location.name,
       buyer_location_address = location.address,
       buyer_location_delivery_zone = location.delivery_zone
  from public.buyer_locations as location
 where location.organization_id = request.organization_id
   and location.id = request.buyer_location_id;

alter table public.buyer_procurement_requests
  enable trigger buyer_procurement_requests_immutable;

alter table public.buyer_procurement_requests
  alter column buyer_location_name set not null,
  alter column buyer_location_address set not null;

create or replace function private.capture_buyer_location_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.buyer_locations%rowtype;
begin
  -- FOR SHARE serializes request creation with a concurrent location edit.
  select location.*
    into v_location
    from public.buyer_locations as location
   where location.organization_id = new.organization_id
     and location.id = new.buyer_location_id
   for share;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'buyer location for procurement request was not found';
  end if;

  new.buyer_location_name := v_location.name;
  new.buyer_location_address := v_location.address;
  new.buyer_location_delivery_zone := v_location.delivery_zone;
  return new;
end;
$$;
revoke all on function private.capture_buyer_location_snapshot() from public, anon, authenticated;

create trigger buyer_procurement_requests_capture_location_snapshot
  before insert on public.buyer_procurement_requests
  for each row execute function private.capture_buyer_location_snapshot();

-- Column grants are explicit; the existing table grant remains read-only and RLS-scoped.
grant select (
  buyer_location_name, buyer_location_address, buyer_location_delivery_zone
) on table public.buyer_procurement_requests to authenticated;

comment on column public.buyer_procurement_requests.buyer_location_name is
  'Immutable name snapshot of the selected buyer location at request submission.';
comment on column public.buyer_procurement_requests.buyer_location_address is
  'Immutable address snapshot of the selected buyer location at request submission.';
comment on column public.buyer_procurement_requests.buyer_location_delivery_zone is
  'Immutable optional delivery-zone snapshot of the selected buyer location at request submission.';
comment on function private.capture_buyer_location_snapshot() is
  'Captures the tenant-scoped buyer location under a share lock before a request insert; later location edits cannot rewrite request history.';
