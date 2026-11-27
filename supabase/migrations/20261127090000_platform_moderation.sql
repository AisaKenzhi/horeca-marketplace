-- Local technical capability for platform moderation of supplier profiles.
--
-- This is a PROTOTYPE authorization boundary, not a legal operator decision.
-- A moderator can only be granted by a trusted server-side process (SQL role),
-- never by client metadata, query string, demo persona or tenant membership.
-- Supplier members can never moderate their own organization.

create table if not exists private.platform_moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table private.platform_moderators enable row level security;
revoke all on table private.platform_moderators from anon, authenticated;

create or replace function private.is_platform_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.platform_moderators as moderator
    where moderator.user_id = (select auth.uid())
      and moderator.revoked_at is null
  );
$$;

revoke all on function private.is_platform_moderator() from public, anon;
grant execute on function private.is_platform_moderator() to authenticated;

create table if not exists private.platform_moderation_events (
  event_id uuid primary key default gen_random_uuid(),
  supplier_organization_id uuid not null,
  moderator_user_id uuid not null,
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table private.platform_moderation_events enable row level security;
revoke all on table private.platform_moderation_events from anon, authenticated;

create or replace function private.reject_moderation_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'moderation history is append-only';
end;
$$;

drop trigger if exists platform_moderation_events_immutable
  on private.platform_moderation_events;
create trigger platform_moderation_events_immutable
before update or delete on private.platform_moderation_events
for each row execute function private.reject_moderation_history_mutation();

create or replace function public.is_platform_moderator()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_platform_moderator();
$$;

revoke all on function public.is_platform_moderator() from public, anon;
grant execute on function public.is_platform_moderator() to authenticated;

create or replace function public.list_pending_supplier_profiles()
returns table (
  organization_id uuid,
  display_name text,
  verification_status text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_platform_moderator() then
    raise exception using errcode = '42501', message = 'moderator role required';
  end if;

  return query
    select profile.organization_id, profile.display_name,
           profile.verification_status, profile.created_at
    from public.supplier_profiles as profile
    where profile.verification_status = 'pending'
    order by profile.created_at, profile.organization_id;
end;
$$;

revoke all on function public.list_pending_supplier_profiles() from public, anon;
grant execute on function public.list_pending_supplier_profiles() to authenticated;

create or replace function public.decide_supplier_verification(
  p_organization_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
-- SECURITY DEFINER is required: client grants intentionally exclude
-- verification_status, so a SECURITY INVOKER function cannot write it. All
-- role/tenant checks are explicit below; search_path is pinned and every
-- object is schema-qualified. Grants are execute-only.
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if not private.is_platform_moderator() then
    raise exception using errcode = '42501', message = 'moderator role required';
  end if;

  -- A supplier member must never approve or reject their own profile, even if
  -- they also hold a platform moderator grant.
  if private.has_org_role(
    p_organization_id,
    array['owner', 'admin', 'catalog_operator', 'order_operator']::text[]
  ) then
    raise exception using errcode = '42501', message = 'supplier cannot moderate own profile';
  end if;

  if p_decision not in ('approve', 'reject')
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception using errcode = '23514', message = 'invalid moderation decision';
  end if;

  update public.supplier_profiles as profile
     set verification_status = case p_decision
           when 'approve' then 'approved'
           else 'rejected'
         end
   where profile.organization_id = p_organization_id
     and profile.verification_status = 'pending';

  if not found then
    raise exception using errcode = '55000', message = 'profile is not pending';
  end if;

  insert into private.platform_moderation_events (
    supplier_organization_id, moderator_user_id, decision, reason
  )
  values (
    p_organization_id,
    (select auth.uid()),
    p_decision,
    btrim(p_reason)
  )
  returning event_id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.decide_supplier_verification(uuid, text, text) from public, anon;
grant execute on function public.decide_supplier_verification(uuid, text, text) to authenticated;

comment on function public.decide_supplier_verification(uuid, text, text) is
  'Local prototype moderation only; not a legal verification, quality certification or supplier approval.';
