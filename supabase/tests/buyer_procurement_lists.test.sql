begin;
select plan(34);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
 ('11000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','buyer@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','receiver@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supplier@test.invalid','',now()),
 ('11000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@test.invalid','',now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
insert into public.organizations(id,name,organization_type,created_by) values
 ('21000000-0000-4000-8000-000000000001','Buyer tenant','buyer',auth.uid()),
 ('21000000-0000-4000-8000-000000000002','Other buyer','buyer',auth.uid());
insert into public.organizations(id,name,organization_type,created_by) values
 ('21000000-0000-4000-8000-000000000006','Supplier tenant','supplier','11000000-0000-4000-8000-000000000001');
insert into public.organization_memberships(organization_id,user_id,role) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','buyer'),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','admin'),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','viewer'),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','receiver'),
 ('21000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000006','owner'),
 ('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000007','owner');
insert into public.supplier_profiles(organization_id,display_name) values ('21000000-0000-4000-8000-000000000006','Supplier');
update public.supplier_profiles set verification_status='approved' where organization_id='21000000-0000-4000-8000-000000000006';
insert into public.catalog_offers(id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,moq,order_step,is_published)
values
 ('41000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000006','PUB','Published','Food','each',1,1,'piece',1,1,true),
 ('41000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000006','DRAFT','Draft','Food','each',1,1,'piece',1,1,false);
insert into public.buyer_procurement_lists(id,organization_id,name,created_by) values
 ('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Weekly order','11000000-0000-4000-8000-000000000001');

select ok((select relrowsecurity from pg_class where oid='public.buyer_procurement_lists'::regclass) and (select relrowsecurity from pg_class where oid='public.buyer_procurement_list_items'::regclass),'RLS enabled on both tables');
select ok(not has_table_privilege('anon','public.buyer_procurement_lists','SELECT') and not has_table_privilege('anon','public.buyer_procurement_list_items','SELECT') and not has_any_column_privilege('anon','public.buyer_procurement_lists','SELECT') and not has_any_column_privilege('anon','public.buyer_procurement_list_items','SELECT'),'anon has no table or column access');
select ok(has_column_privilege('authenticated','public.buyer_procurement_lists','organization_id','INSERT') and has_column_privilege('authenticated','public.buyer_procurement_lists','name','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_lists','organization_id','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_lists','created_by','INSERT') and not has_column_privilege('authenticated','public.buyer_procurement_lists','id','INSERT') and not has_column_privilege('authenticated','public.buyer_procurement_lists','created_at','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_lists','updated_at','UPDATE') and has_column_privilege('authenticated','public.buyer_procurement_list_items','quantity','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','organization_id','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','list_id','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','catalog_offer_id','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','id','INSERT') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','created_at','UPDATE') and not has_column_privilege('authenticated','public.buyer_procurement_list_items','updated_at','UPDATE'),'grants protect tenant, creator, id, offer reference, and timestamps');

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.buyer_procurement_lists),1,'buyer membership reads own list');
select lives_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000001','Buyer created')$$,'buyer membership creates list and defaults creator');
select is((select created_by from public.buyer_procurement_lists where name='Buyer created'),'11000000-0000-4000-8000-000000000002'::uuid,'creator is auth.uid');
select lives_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',3)$$,'positive quantity references published approved offer');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',0)$$,'23514',null,'zero quantity rejected');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',-1)$$,'23514',null,'negative quantity rejected');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002',1)$$,'23514',null,'draft offer rejected');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000099',1)$$,'23514',null,'nonexistent offer reference rejected by the published-offer trigger');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001',1)$$,'23503',null,'nonexistent owning list FK rejected');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',1)$$,'42501',null,'RLS prevents pairing a list with another tenant id');
select throws_ok($$insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',1)$$,'23505',null,'duplicate list offer rejected');
select lives_ok($$update public.buyer_procurement_lists set name='Renamed list' where id='31000000-0000-4000-8000-000000000001'$$,'buyer can update own list');
select lives_ok($$update public.buyer_procurement_list_items set quantity=4 where list_id='31000000-0000-4000-8000-000000000001' and catalog_offer_id='41000000-0000-4000-8000-000000000001'$$,'buyer can update own item quantity');
select lives_ok($$delete from public.buyer_procurement_list_items where list_id='31000000-0000-4000-8000-000000000001' and catalog_offer_id='41000000-0000-4000-8000-000000000001'$$,'buyer can delete own item');
select lives_ok($$delete from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000001'$$,'buyer can delete own list');
select is((select count(*)::int from public.buyer_procurement_lists where organization_id='21000000-0000-4000-8000-000000000002'),0,'other tenant not visible');
select throws_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000002','Foreign write')$$,'42501',null,'buyer cannot write another tenant list');
reset role;

-- Separate seeded list for role/read access assertions.
insert into public.buyer_procurement_lists(id,organization_id,name,created_by) values ('31000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','Access fixture','11000000-0000-4000-8000-000000000001');
insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values ('21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001',1);

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),1,'viewer can read list');
select throws_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000001','Viewer write')$$,'42501',null,'viewer cannot create lists');
select lives_ok($$update public.buyer_procurement_lists set name='Viewer attempt' where id='31000000-0000-4000-8000-000000000003'$$,'viewer update is filtered by RLS');
select is((select name from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),'Access fixture','viewer update did not change list');
select lives_ok($$delete from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'$$,'viewer delete is filtered by RLS');
select is((select count(*)::int from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),1,'viewer delete left list intact');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000005',true);
select is((select count(*)::int from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),0,'receiver excluded from list reads');
select throws_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000001','Receiver write')$$,'42501',null,'receiver excluded from writes');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000006',true);
select is((select count(*)::int from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),0,'supplier cannot read buyer list');
select throws_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000001','Supplier write')$$,'42501',null,'supplier cannot create buyer list');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000007',true);
select is((select count(*)::int from public.buyer_procurement_lists where id='31000000-0000-4000-8000-000000000003'),0,'other buyer tenant cannot see list');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
select lives_ok($$insert into public.buyer_procurement_lists(organization_id,name) values ('21000000-0000-4000-8000-000000000001','Admin list')$$,'admin membership can create list');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.buyer_procurement_lists$$,'42501',null,'anon cannot query lists');
select throws_ok($$select * from public.buyer_procurement_list_items$$,'42501',null,'anon cannot query list items');
reset role;

select * from finish();
rollback;
