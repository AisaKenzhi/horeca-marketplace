-- Tenant membership management and single-use invitation lifecycle.
create extension if not exists pgcrypto with schema extensions;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('owner','admin','buyer','viewer','receiver','catalog_operator','order_operator')),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz
);
create index organization_invitations_org_created_idx on public.organization_invitations(organization_id, created_at desc);
create unique index organization_invitations_pending_email_idx on public.organization_invitations(organization_id, email) where revoked_at is null and accepted_at is null;
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;
revoke all on public.organization_memberships from anon, authenticated;
grant select on public.organization_memberships to authenticated;
create policy organization_invitations_deny_all on public.organization_invitations for all using (false) with check (false);

create or replace function public.list_organization_members(p_organization_id uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or p_organization_id is null then return; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')) then return; end if;
 return query select m.user_id, u.email::text, m.role, m.created_at from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id order by m.created_at,m.user_id;
end $$;

create or replace function public.list_organization_invitations(p_organization_id uuid)
returns table(invitation_id uuid, email text, role text, invited_by uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or p_organization_id is null then return; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')) then return; end if;
 return query select i.id,i.email,i.role,i.invited_by,i.created_at,i.expires_at from public.organization_invitations i where i.organization_id=p_organization_id and i.revoked_at is null and i.accepted_at is null and i.expires_at>clock_timestamp() order by i.created_at desc;
end $$;

create or replace function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role text,p_token text)
returns table(invitation_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_hash bytea; v_id uuid; v_exp timestamptz; v_actor text;
begin
 if (select auth.uid()) is null or p_organization_id is null or p_email is null or p_role is null or p_token is null then return; end if;
 v_email:=lower(btrim(p_email));
 if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_role not in ('owner','admin','buyer','viewer','receiver','catalog_operator','order_operator') or p_token !~ '^[A-Za-z0-9_-]{43}$' then return; end if;
 perform 1 from public.organizations o where o.id=p_organization_id for update;
 if not found then return; end if;
 select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
 if v_actor is null or v_actor not in ('owner','admin') then return; end if;
 if p_role='owner' and v_actor<>'owner' then return; end if;
 update public.organization_invitations i set revoked_at=clock_timestamp() where i.organization_id=p_organization_id and i.email=v_email and i.revoked_at is null and i.accepted_at is null and i.expires_at<=clock_timestamp();
 v_hash:=extensions.digest(convert_to(p_token,'UTF8'),'sha256'); v_exp:=now()+interval '7 days';
 insert into public.organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at) values(p_organization_id,v_email,p_role,v_hash,(select auth.uid()),v_exp) returning id,organization_invitations.expires_at into v_id,v_exp;
 return query select v_id,v_exp;
exception when unique_violation or foreign_key_violation or check_violation then return;
end $$;

create or replace function public.revoke_organization_invitation(p_organization_id uuid,p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor text;
begin
 if (select auth.uid()) is null or p_organization_id is null or p_invitation_id is null then return false; end if;
 perform 1 from public.organizations o where o.id=p_organization_id for update;
 if not found then return false; end if;
 select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
 if v_actor is null or v_actor not in ('owner','admin') then return false; end if;
 update public.organization_invitations i set revoked_at=clock_timestamp() where i.id=p_invitation_id and i.organization_id=p_organization_id and i.revoked_at is null and i.accepted_at is null and i.expires_at>clock_timestamp();
 return found;
end $$;

create or replace function public.change_organization_member_role(p_organization_id uuid,p_user_id uuid,p_role text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_target text;
begin
	if (select auth.uid()) is null or p_organization_id is null or p_user_id is null or p_role is null or p_role not in ('owner','admin','buyer','viewer','receiver','catalog_operator','order_operator') then return false; end if;
	select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
	if v_actor is null or v_actor not in ('owner','admin') then return false; end if;
	perform 1 from public.organizations o where o.id=p_organization_id for update;
	if not found then return false; end if;
	select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
	if v_actor is null or v_actor not in ('owner','admin') then return false; end if;
	select m.role into v_target from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
	if v_target is null or (v_actor<>'owner' and (v_target='owner' or p_role='owner')) then return false; end if;
	if v_target='owner' and p_role<>'owner' and (select count(*) from public.organization_memberships m where m.organization_id=p_organization_id and m.role='owner')<=1 then return false; end if;
 update public.organization_memberships m set role=p_role where m.organization_id=p_organization_id and m.user_id=p_user_id;
 return found;
end $$;

create or replace function public.remove_organization_member(p_organization_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor text; v_target text;
begin
	if (select auth.uid()) is null or p_organization_id is null or p_user_id is null then return false; end if;
	select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
	if v_actor is null or v_actor not in ('owner','admin') then return false; end if;
	perform 1 from public.organizations o where o.id=p_organization_id for update;
	if not found then return false; end if;
	select m.role into v_actor from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
	if v_actor is null or v_actor not in ('owner','admin') then return false; end if;
	select m.role into v_target from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
	if v_target is null or (v_actor<>'owner' and v_target='owner') then return false; end if;
 if v_target='owner' and (select count(*) from public.organization_memberships m where m.organization_id=p_organization_id and m.role='owner')<=1 then return false; end if;
 delete from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id;
 return found;
end $$;

create or replace function public.accept_organization_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text; v_org uuid; v_role text; v_inv public.organization_invitations%rowtype;
begin
 if (select auth.uid()) is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
 select lower(u.email) into v_email from auth.users u where u.id=(select auth.uid());
 if v_email is null then return null; end if;
 select i.organization_id into v_org from public.organization_invitations i where i.token_hash=extensions.digest(convert_to(p_token,'UTF8'),'sha256');
 if not found then return null; end if;
 perform 1 from public.organizations o where o.id=v_org for update;
 if not found then return null; end if;
 select i.* into v_inv from public.organization_invitations i where i.token_hash=extensions.digest(convert_to(p_token,'UTF8'),'sha256') for update;
 if not found or v_inv.organization_id<>v_org or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at<=clock_timestamp() or v_inv.email<>v_email then return null; end if;
 v_role:=v_inv.role;
 insert into public.organization_memberships(organization_id,user_id,role) values(v_org,(select auth.uid()),v_role) on conflict(organization_id,user_id) do nothing;
 if not found then return null; end if;
 update public.organization_invitations i set accepted_at=clock_timestamp() where i.id=v_inv.id;
 return v_org;
exception when unique_violation or foreign_key_violation then return null;
end $$;

revoke all on function public.list_organization_members(uuid) from public,anon;
revoke all on function public.list_organization_invitations(uuid) from public,anon;
revoke all on function public.create_organization_invitation(uuid,text,text,text) from public,anon;
revoke all on function public.revoke_organization_invitation(uuid,uuid) from public,anon;
revoke all on function public.change_organization_member_role(uuid,uuid,text) from public,anon;
revoke all on function public.remove_organization_member(uuid,uuid) from public,anon;
revoke all on function public.accept_organization_invitation(text) from public,anon;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,text) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid,uuid) to authenticated;
grant execute on function public.change_organization_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.remove_organization_member(uuid,uuid) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
