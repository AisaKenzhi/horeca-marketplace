begin;
select plan(54);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
 ('12000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','buyer-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','receiver-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supplier-cart@test.invalid','',now()),
 ('12000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-cart@test.invalid','',now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
insert into public.organizations(id,name,organization_type,created_by) values
 ('22000000-0000-4000-8000-000000000001','Buyer tenant','buyer',auth.uid()),
 ('22000000-0000-4000-8000-000000000006','Supplier tenant','supplier',auth.uid());
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000007',true);
insert into public.organizations(id,name,organization_type,created_by)
values ('22000000-0000-4000-8000-000000000002','Other buyer','buyer',auth.uid());
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
insert into public.organization_memberships(organization_id,user_id,role) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','buyer'),
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000003','admin'),
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000004','viewer'),
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000005','receiver'),
 ('22000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000006','owner');
insert into public.buyer_locations(id,organization_id,name,address,delivery_zone) values
 ('52000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Buyer location','Test address','Zone A'),
 ('52000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','Other location','Other address','Zone B');
insert into public.supplier_profiles(organization_id,display_name)
values ('22000000-0000-4000-8000-000000000006','Supplier');
update public.supplier_profiles
   set verification_status='approved'
 where organization_id='22000000-0000-4000-8000-000000000006';
insert into public.catalog_offers(
  id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,
  units_per_sell_unit,pack_amount,pack_base_unit,moq,order_step,is_published
) values
 ('42000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000006','PUB-1','Published one','Food','bag',1,1,'piece',1,1,true),
 ('42000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000006','PUB-2','Published two','Food','box',1,1,'piece',1,1,true),
 ('42000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000006','PUB-3','Later unpublished','Food','each',1,1,'piece',1,1,true);
insert into public.buyer_procurement_lists(id,organization_id,name,created_by) values
 ('32000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Pantry','12000000-0000-4000-8000-000000000001'),
 ('32000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001','Empty list','12000000-0000-4000-8000-000000000001'),
 ('32000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000001','Stale list','12000000-0000-4000-8000-000000000001'),
 ('32000000-0000-4000-8000-000000000004','22000000-0000-4000-8000-000000000002','Other tenant list','12000000-0000-4000-8000-000000000007');
insert into public.buyer_procurement_list_items(organization_id,list_id,catalog_offer_id,quantity) values
 ('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001',2),
 ('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',4),
 ('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000003','42000000-0000-4000-8000-000000000003',1);
update public.catalog_offers set is_published=false
 where id='42000000-0000-4000-8000-000000000003';

select ok(
  (select relrowsecurity from pg_class where oid='public.buyer_draft_carts'::regclass)
  and (select relrowsecurity from pg_class where oid='public.buyer_draft_cart_items'::regclass),
  'RLS is enabled on both draft-cart tables'
);
select ok(
  not has_table_privilege('anon','public.buyer_draft_carts','SELECT')
  and not has_table_privilege('anon','public.buyer_draft_cart_items','SELECT')
  and not has_any_column_privilege('anon','public.buyer_draft_carts','SELECT')
  and not has_any_column_privilege('anon','public.buyer_draft_cart_items','SELECT'),
  'anon has no table or column access'
);
select ok(
  not has_function_privilege('anon','public.create_buyer_draft_cart(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_buyer_draft_cart(uuid,uuid)','EXECUTE')
  and not (select prosecdef from pg_proc where oid='public.create_buyer_draft_cart(uuid,uuid)'::regprocedure)
  and has_schema_privilege('authenticated','private','USAGE')
  and has_function_privilege('authenticated','private.create_buyer_draft_cart(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','private.create_buyer_draft_cart(uuid,uuid)','EXECUTE')
  and (select prosecdef from pg_proc where oid='private.create_buyer_draft_cart(uuid,uuid)'::regprocedure),
  'authenticated callers use the invoker RPC wrapper and only it delegates to the private definer worker'
);
select ok(
  not has_column_privilege('authenticated','public.buyer_draft_carts','organization_id','INSERT')
  and not has_column_privilege('authenticated','public.buyer_draft_carts','source_list_name','INSERT')
  and not has_column_privilege('authenticated','public.buyer_draft_carts','created_by','INSERT')
  and not has_column_privilege('authenticated','public.buyer_draft_carts','organization_id','UPDATE')
  and has_column_privilege('authenticated','public.buyer_draft_carts','buyer_location_id','UPDATE')
      and not has_column_privilege('authenticated','public.buyer_draft_carts','source_list_name','UPDATE')
      and not has_table_privilege('authenticated','public.buyer_draft_carts','UPDATE')
      and not has_column_privilege('authenticated','public.buyer_draft_cart_items','organization_id','UPDATE')
      and not has_column_privilege('authenticated','public.buyer_draft_cart_items','catalog_offer_id','UPDATE')
      and not has_column_privilege('authenticated','public.buyer_draft_cart_items','catalog_offer_version','UPDATE')
      and not has_column_privilege('authenticated','public.buyer_draft_cart_items','quantity','UPDATE')
      and not has_table_privilege('authenticated','public.buyer_draft_cart_items','DELETE')
      and has_function_privilege('authenticated','public.update_buyer_draft_cart_item_quantity(uuid,uuid,integer)','EXECUTE')
      and has_function_privilege('authenticated','public.delete_buyer_draft_cart_item(uuid,uuid)','EXECUTE')
      and not has_table_privilege('authenticated','public.buyer_draft_carts','INSERT')
  and not has_any_column_privilege('authenticated','public.buyer_draft_carts','INSERT')
  and not has_table_privilege('authenticated','public.buyer_draft_cart_items','INSERT')
  and not has_any_column_privilege('authenticated','public.buyer_draft_cart_items','INSERT'),
  'grants expose only required cart writes and editable quantities'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.buyer_draft_carts),0,'buyer starts with no draft carts');
select lives_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  'buyer creates a draft by atomically copying a saved list'
);
select set_config('test.cart_id',(
  select id::text from public.buyer_draft_carts
  where source_list_name='Pantry' order by created_at desc limit 1
),true);
select set_config('test.cart_item_id',(
  select id::text from public.buyer_draft_cart_items
  where cart_id=current_setting('test.cart_id')::uuid order by created_at limit 1
),true);
select is((select count(*)::int from public.buyer_draft_carts),1,'one draft header is persisted');
select is((select source_list_name from public.buyer_draft_carts limit 1),'Pantry','source list name is retained for display');
select is((select count(*)::int from public.buyer_draft_cart_items),2,'all source lines are copied');
select is((select sum(quantity)::int from public.buyer_draft_cart_items),6,'source quantities are copied');
select is((select count(*)::int from public.buyer_draft_cart_items where catalog_offer_version=1),2,'current offer versions are captured');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000002')$$,
  '23514',null,'empty saved lists cannot create empty draft carts'
);
select is((select count(*)::int from public.buyer_draft_carts),1,'empty-list failure leaves no partial cart');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000003')$$,
  'P0001',null,'a list with an unpublished offer is rejected as a whole'
);
select is((select count(*)::int from public.buyer_draft_carts),1,'stale-offer failure rolls back its cart header');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000099')$$,
  'P0002',null,'missing saved list returns not found without leaking data'
);
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000004')$$,
  '42501',null,'buyer cannot create a cart for another organization'
);
select throws_ok(
  $$insert into public.buyer_draft_carts(organization_id,source_list_name) values ('22000000-0000-4000-8000-000000000001','Direct')$$,
  '42501',null,'buyer cannot bypass the atomic RPC with a direct same-tenant cart insert'
);
select throws_ok(
  $$insert into public.buyer_draft_cart_items(organization_id,cart_id,catalog_offer_id,quantity,catalog_offer_version) values ('22000000-0000-4000-8000-000000000001',current_setting('test.cart_id')::uuid,'42000000-0000-4000-8000-000000000001',1,1)$$,
  '42501',null,'buyer cannot bypass the atomic RPC with a direct cart-item insert'
);
select throws_ok(
  $$insert into public.buyer_draft_cart_items(organization_id,cart_id,catalog_offer_id,quantity,catalog_offer_version) values ('22000000-0000-4000-8000-000000000001',current_setting('test.cart_id')::uuid,'42000000-0000-4000-8000-000000000003',1,1)$$,
  '42501',null,'authenticated clients cannot directly insert even stale offer lines'
);
select lives_ok(
  $$select public.update_buyer_draft_cart_item_quantity('22000000-0000-4000-8000-000000000001',current_setting('test.cart_item_id')::uuid,5)$$,
  'buyer updates a cart quantity through the parent-locking RPC'
);
select is((select quantity from public.buyer_draft_cart_items where id=current_setting('test.cart_item_id')::uuid),5,'quantity update persists');
select lives_ok(
  $$update public.buyer_draft_carts set buyer_location_id='52000000-0000-4000-8000-000000000001' where id=current_setting('test.cart_id')::uuid$$,
  'buyer can save a location owned by the same organization'
);
select is(
  (select buyer_location_id::text from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid),
  '52000000-0000-4000-8000-000000000001',
  'selected buyer location is persisted on the draft'
);
select throws_ok(
  $$update public.buyer_draft_carts set buyer_location_id='52000000-0000-4000-8000-000000000002' where id=current_setting('test.cart_id')::uuid$$,
  '23503',null,'composite foreign key rejects a location from another organization'
);
select is(
  (select buyer_location_id::text from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid),
  '52000000-0000-4000-8000-000000000001',
  'rejected foreign location does not alter the saved buyer location'
);
reset role;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$insert into public.buyer_draft_cart_items(organization_id,cart_id,catalog_offer_id,quantity,catalog_offer_version) values ('22000000-0000-4000-8000-000000000001',current_setting('test.cart_id')::uuid,'42000000-0000-4000-8000-000000000003',1,1)$$,
  '23514',null,'the offer-validation trigger rejects unpublished offers on privileged writes'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from public.buyer_draft_carts),1,'viewer can read the tenant draft cart');
select is((select count(*)::int from public.buyer_draft_cart_items),2,'viewer can read its lines');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  '42501',null,'viewer cannot create a draft cart'
);
select lives_ok(
  $$delete from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid$$,
  'viewer delete is filtered by RLS'
);
select is((select count(*)::int from public.buyer_draft_carts),1,'viewer delete leaves the cart intact');
select throws_ok(
  $$update public.buyer_draft_cart_items set quantity=9 where id=current_setting('test.cart_item_id')::uuid$$,
  '42501',null,'viewer cannot update cart lines directly'
);
select is((select quantity from public.buyer_draft_cart_items where id=current_setting('test.cart_item_id')::uuid),5,'viewer update did not change quantity');
select lives_ok(
  $$update public.buyer_draft_carts set buyer_location_id=null where id=current_setting('test.cart_id')::uuid$$,
  'viewer location update is filtered by RLS'
);
select is(
  (select buyer_location_id::text from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid),
  '52000000-0000-4000-8000-000000000001',
  'viewer cannot change the selected buyer location'
);
select throws_ok(
  $$delete from public.buyer_draft_cart_items where id=current_setting('test.cart_item_id')::uuid$$,
  '42501',null,'viewer cannot delete cart lines directly'
);
select is((select count(*)::int from public.buyer_draft_cart_items),2,'viewer delete leaves cart lines intact');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000005',true);
select is((select count(*)::int from public.buyer_draft_carts),0,'receiver cannot read buyer procurement carts');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  '42501',null,'receiver cannot create draft carts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000006',true);
select is((select count(*)::int from public.buyer_draft_carts),0,'supplier cannot read buyer draft carts');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  '42501',null,'supplier cannot create buyer draft carts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000007',true);
select is((select count(*)::int from public.buyer_draft_carts),0,'other buyer tenant cannot see draft carts');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  '42501',null,'other buyer tenant cannot create a foreign draft cart'
);
select lives_ok(
  $$update public.buyer_draft_carts set buyer_location_id='52000000-0000-4000-8000-000000000002' where id=current_setting('test.cart_id')::uuid$$,
  'other buyer tenant update of a foreign cart is filtered by RLS'
);
reset role;
select is(
  (select buyer_location_id::text from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid),
  '52000000-0000-4000-8000-000000000001',
  'cross-tenant update leaves the original location unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000003',true);
select lives_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  'admin membership can create a tenant draft cart'
);
select is((select count(*)::int from public.buyer_draft_carts),2,'admin-created cart is persisted');
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.buyer_draft_carts$$,'42501',null,'anon cannot query draft carts');
select throws_ok($$select * from public.buyer_draft_cart_items$$,'42501',null,'anon cannot query draft cart items');
select throws_ok(
  $$select public.create_buyer_draft_cart('22000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001')$$,
  '42501',null,'anon cannot execute the draft-cart RPC'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
select lives_ok(
  $$delete from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid$$,
  'buyer can delete its own draft cart'
);
select is((select count(*)::int from public.buyer_draft_cart_items where cart_id=current_setting('test.cart_id')::uuid),0,'deleting a draft cascades its lines');
select is((select count(*)::int from public.buyer_draft_carts),1,'deleting one draft leaves the other cart intact');
reset role;

select * from finish();
rollback;
