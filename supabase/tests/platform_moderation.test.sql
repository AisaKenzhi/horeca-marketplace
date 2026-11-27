begin;
select plan(21);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
 ('53000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','moderator@example.test','',now()),
 ('53000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supplier-owner@example.test','',now()),
 ('53000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider@example.test','',now());

select set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000002',true);
insert into public.organizations(id,name,organization_type,created_by) values
 ('54000000-0000-4000-8000-000000000001','Moderation Supplier A','supplier','53000000-0000-4000-8000-000000000002'),
 ('54000000-0000-4000-8000-000000000002','Moderation Supplier B','supplier','53000000-0000-4000-8000-000000000002');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('54000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002','owner');
insert into public.supplier_profiles(organization_id,display_name,verification_status) values
 ('54000000-0000-4000-8000-000000000001','Pending supplier A','pending'),
 ('54000000-0000-4000-8000-000000000002','Pending supplier B','pending');

-- Only a trusted SQL writer can grant the platform moderator role.
insert into private.platform_moderators(user_id,granted_by) values
 ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001');

select ok(
  not has_table_privilege('anon','private.platform_moderators','SELECT')
  and not has_table_privilege('authenticated','private.platform_moderators','SELECT')
  and not has_table_privilege('authenticated','private.platform_moderation_events','INSERT')
  and not has_table_privilege('authenticated','private.platform_moderation_events','UPDATE')
  and not has_table_privilege('authenticated','private.platform_moderation_events','DELETE'),
  'private moderation tables have no direct client grants');
select ok(
  (select relrowsecurity from pg_class where oid='private.platform_moderators'::regclass)
  and (select relrowsecurity from pg_class where oid='private.platform_moderation_events'::regclass),
  'private moderation tables have RLS enabled');
select ok(
  not has_function_privilege('anon','public.list_pending_supplier_profiles()','EXECUTE')
  and not has_function_privilege('anon','public.decide_supplier_verification(uuid, text, text)','EXECUTE')
  and has_function_privilege('authenticated','public.list_pending_supplier_profiles()','EXECUTE')
  and has_function_privilege('authenticated','public.decide_supplier_verification(uuid, text, text)','EXECUTE'),
  'moderation RPCs are granted to authenticated only');

set local role authenticated;
select set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000003',true);
select is(public.is_platform_moderator(),false,'outsider is not a platform moderator');
select is((select count(*)::int from public.list_pending_supplier_profiles()),0,'outsider sees no pending profiles');
select throws_ok(
  $$select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','approve','synthetic')$$,
  '42501',null,'outsider cannot approve a supplier');

select set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000002',true);
select is(public.is_platform_moderator(),false,'supplier owner is not a platform moderator');
select throws_ok(
  $$select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','approve','synthetic')$$,
  '42501',null,'supplier cannot approve own profile');

select set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000001',true);
select is(public.is_platform_moderator(),true,'trusted grant makes the moderator identifiable');
select is((select count(*)::int from public.list_pending_supplier_profiles()),2,'moderator lists pending profiles');
select ok(
  (select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','approve','Synthetic verification decision'))
    is not null,
  'moderator approve returns an event id');
select is(
  (select verification_status from public.supplier_profiles where organization_id='54000000-0000-4000-8000-000000000001'),
  'approved','approved profile changes to approved');
select is((select count(*)::int from private.platform_moderation_events),1,'decision writes one audit event');
select throws_ok(
  $$select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','reject','late decision')$$,
  '55000',null,'already decided profile cannot be decided twice');
select ok(
  (select public.decide_supplier_verification('54000000-0000-4000-8000-000000000002','reject','Synthetic rejection reason'))
    is not null,
  'moderator reject returns an event id');
select is(
  (select verification_status from public.supplier_profiles where organization_id='54000000-0000-4000-8000-000000000002'),
  'rejected','rejected profile changes to rejected');
select throws_ok(
  $$select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','unknown','synthetic')$$,
  '23514',null,'invalid decision value is rejected');
select throws_ok(
  $$select public.decide_supplier_verification('54000000-0000-4000-8000-000000000001','approve','  ')$$,
  '23514',null,'empty reason is rejected');
select is((select count(*)::int from private.platform_moderation_events),2,'invalid decisions create no audit event');
reset role;
select throws_ok(
  $$delete from private.platform_moderation_events$$,
  'P0001',null,'moderation history is append-only');
select is((select count(*)::int from private.platform_moderation_events),2,'failed history mutation leaves audit intact');

rollback;
