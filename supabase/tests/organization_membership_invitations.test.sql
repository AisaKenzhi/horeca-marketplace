begin;
select plan(42);
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
 ('51000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@example.test','',now()),
 ('51000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@example.test','',now()),
 ('51000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@example.test','',now()),
 ('51000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@example.test','',now()),
 ('51000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','newhire@example.test','',now());
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
insert into public.organizations(id,name,organization_type,created_by) values('52000000-0000-4000-8000-000000000001','Invitation Test','buyer',auth.uid());
insert into public.organization_memberships(organization_id,user_id,role) values
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','admin'),
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','buyer');
select ok(not has_table_privilege('anon','public.organization_invitations','SELECT') and not has_table_privilege('authenticated','public.organization_invitations','SELECT') and not has_table_privilege('authenticated','public.organization_invitations','INSERT') and not has_table_privilege('authenticated','public.organization_invitations','UPDATE') and not has_table_privilege('authenticated','public.organization_invitations','DELETE'),'invitation table has no direct client grants');
select ok((select relrowsecurity from pg_class where oid='public.organization_invitations'::regclass),'invitation table has RLS enabled');
select ok(not has_table_privilege('authenticated','public.organization_memberships','INSERT') and not has_table_privilege('authenticated','public.organization_memberships','UPDATE') and not has_table_privilege('authenticated','public.organization_memberships','DELETE'),'membership writes are RPC-only');
select ok(not has_function_privilege('anon','public.list_organization_members(uuid)','EXECUTE') and has_function_privilege('authenticated','public.list_organization_members(uuid)','EXECUTE'),'RPC privileges exclude anon and allow authenticated');
set local role authenticated;
select is((select count(*)::int from public.list_organization_members('52000000-0000-4000-8000-000000000001')),3,'owner lists all tenant members');
select is((select count(*)::int from public.list_organization_members('52000000-0000-4000-8000-000000000002')),0,'guessed foreign organization returns empty member list');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.list_organization_members('52000000-0000-4000-8000-000000000001')),3,'admin can list members');
select is((select count(*)::int from public.list_organization_invitations('52000000-0000-4000-8000-000000000001')),0,'admin initially sees no invitations');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001',' NewHire@Example.Test ','buyer',repeat('A',43))),1,'manager creates normalized invitation');
reset role;
select is((select email from public.organization_invitations where email='newhire@example.test'),'newhire@example.test','stored email is trimmed and lowercase');
select ok((select token_hash<>convert_to(repeat('A',43),'UTF8') and token_hash=extensions.digest(convert_to(repeat('A',43),'UTF8'),'sha256') from public.organization_invitations where email='newhire@example.test'),'only SHA-256 token hash is stored, not plaintext');
select is((select expires_at-created_at from public.organization_invitations where email='newhire@example.test'),interval '7 days','expiry is fixed at seven days');
set local role authenticated;
select is((select count(*)::int from public.list_organization_invitations('52000000-0000-4000-8000-000000000001')),1,'manager invitation listing returns pending data without token fields');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','bad-email','buyer',repeat('B',43))),0,'invalid email rejected neutrally');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','badtoken@example.test','buyer','bad')),0,'invalid token encoding rejected neutrally');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','ownerinvite@example.test','owner',repeat('C',43))),0,'invitation cannot grant owner role');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','nullrole@example.test',null,repeat('G',43))),0,'NULL invitation role is rejected');
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003',null::text),false,'NULL member role is rejected');
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','buyer'),false,'admin cannot demote owner');
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','owner'),false,'admin cannot grant owner role');
select is(public.remove_organization_member('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001'),false,'admin cannot remove owner');
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','viewer'),true,'admin can change non-owner role');
select is(public.remove_organization_member('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003'),true,'admin can remove non-owner member');
select is(public.revoke_organization_invitation('52000000-0000-4000-8000-000000000001',(select id from public.organization_invitations where email='newhire@example.test')),true,'manager can revoke pending invitation');
select is(public.accept_organization_invitation(repeat('A',43)),null::uuid,'revoked invitation cannot be accepted');
select is(public.accept_organization_invitation('invalid'),null::uuid,'malformed token is rejected');
reset role;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*)::int from public.list_organization_members('52000000-0000-4000-8000-000000000001')),0,'non-manager receives no member data');
select is((select count(*)::int from public.list_organization_invitations('52000000-0000-4000-8000-000000000001')),0,'non-manager receives no invitation data');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','someone@example.test','buyer',repeat('D',43))),0,'non-manager cannot create invitation and receives no id');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000004',true);
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','viewer'),false,'authenticated non-member cannot change a guessed tenant member role');
select is(public.remove_organization_member('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003'),false,'authenticated non-member cannot remove a guessed tenant member');
reset role;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001','newhire@example.test','buyer',repeat('E',43))),1,'owner can create invitation for acceptance lifecycle');
reset role;
update public.organization_invitations set expires_at=clock_timestamp()-interval '1 second' where email='newhire@example.test' and token_hash=extensions.digest(convert_to(repeat('E',43),'UTF8'),'sha256');
set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000005',true);
select is(public.accept_organization_invitation(repeat('E',43)),null::uuid,'expired invitation cannot be accepted');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.list_organization_invitations('52000000-0000-4000-8000-000000000001')),0,'expired pending invitations are not listed');
select is((select count(*)::int from public.create_organization_invitation('52000000-0000-4000-8000-000000000001',' NEWHIRE@example.test ','buyer',repeat('F',43))),1,'expired invitation permits a normalized reinvitation');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000004',true);
select is(public.accept_organization_invitation(repeat('F',43)),null::uuid,'identity with a different Auth email cannot accept');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000005',true);
select is(public.accept_organization_invitation(repeat('F',43)),'52000000-0000-4000-8000-000000000001'::uuid,'matching Auth email accepts invitation atomically');
select is(public.accept_organization_invitation(repeat('F',43)),null::uuid,'accepted invitation cannot be consumed twice');
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','admin'),false,'last owner cannot be demoted');
select is(public.remove_organization_member('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001'),false,'last owner cannot be removed');
select is(public.change_organization_member_role('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','owner'),true,'owner can promote another member to owner');
select is(public.remove_organization_member('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001'),true,'owner can remove self when another owner remains');
reset role;
select * from finish();
rollback;
