begin;
select no_plan();

-- Synthetic users, tenants, suppliers, catalog rows, lists and requests only.
-- This suite is intended for disposable local Supabase/Postgres test databases.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('13000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-owner@test.invalid','',now()),
  ('13000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-buyer@test.invalid','',now()),
  ('13000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-viewer@test.invalid','',now()),
  ('13000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-other@test.invalid','',now()),
  ('13000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-supplier-a@test.invalid','',now()),
  ('13000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','request-supplier-b@test.invalid','',now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
insert into public.organizations (id,name,organization_type,created_by) values
  ('23000000-0000-4000-8000-000000000001','Request buyer','buyer',auth.uid()),
  ('23000000-0000-4000-8000-000000000003','Request supplier A','supplier',auth.uid());
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000004',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('23000000-0000-4000-8000-000000000002','Other request buyer','buyer',auth.uid());
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000006',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('23000000-0000-4000-8000-000000000004','Request supplier B','supplier',auth.uid());
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
insert into public.organization_memberships (organization_id,user_id,role) values
  ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002','buyer'),
  ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000003','viewer');
insert into public.buyer_locations (id,organization_id,name,address) values
  ('53000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','Buyer kitchen','Synthetic address A'),
  ('53000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002','Other kitchen','Synthetic address B');
insert into public.supplier_profiles (organization_id,display_name) values
  ('23000000-0000-4000-8000-000000000003','Supplier A'),
  ('23000000-0000-4000-8000-000000000004','Supplier B');
update public.supplier_profiles
   set verification_status='approved'
 where organization_id in ('23000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000004');
insert into public.catalog_offers (
  id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,
  units_per_sell_unit,pack_amount,pack_base_unit,price_amount,currency,moq,
  order_step,availability,price_valid_until,is_published
) values
  ('43000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000003','FLOUR-1','Flour','Grocery','sack',1,5,'kg',123.45,'PLN',2,2,'in_stock',now()+interval '1 day',true),
  ('43000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000004','OIL-1','Oil','Grocery','bottle',1,1,'l',200.00,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  ('43000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000003','STALE-PRICE','Stale price item','Grocery','box',1,2,'kg',50.00,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  ('43000000-0000-4000-8000-000000000004','23000000-0000-4000-8000-000000000003','MOQ-STEP','MOQ blocker','Grocery','case',1,6,'piece',10.00,'PLN',5,2,'in_stock',now()+interval '1 day',true),
  ('43000000-0000-4000-8000-000000000005','23000000-0000-4000-8000-000000000004','EXPIRED','Expired price item','Grocery','jar',1,1,'l',20.00,'PLN',1,1,'in_stock',now()-interval '1 minute',true),
  ('43000000-0000-4000-8000-000000000006','23000000-0000-4000-8000-000000000004','OUT-OF-STOCK','Unavailable item','Grocery','bag',1,1,'kg',30.00,'PLN',1,1,'out_of_stock',now()+interval '1 day',true);
insert into public.buyer_procurement_lists (id,organization_id,name,created_by) values
  ('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','Pantry','13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','Stale price','13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000001','MOQ step','13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000004','23000000-0000-4000-8000-000000000001','Expired price','13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000005','23000000-0000-4000-8000-000000000001','Availability blocker','13000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000006','23000000-0000-4000-8000-000000000001','Stale version','13000000-0000-4000-8000-000000000001');
insert into public.buyer_procurement_list_items (organization_id,list_id,catalog_offer_id,quantity) values
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',4),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000002',2),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000003',1),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000004',3),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000004','43000000-0000-4000-8000-000000000005',1),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000005','43000000-0000-4000-8000-000000000006',1),
  ('23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000006','43000000-0000-4000-8000-000000000002',2);

select ok(
  (select relrowsecurity from pg_class where oid='public.buyer_procurement_requests'::regclass)
  and (select relrowsecurity from pg_class where oid='public.buyer_procurement_request_lines'::regclass)
  and (select relrowsecurity from pg_class where oid='private.platform_supplier_suborders'::regclass)
  and (select relrowsecurity from pg_class where oid='private.platform_supplier_suborder_lines'::regclass),
  'RLS is enabled on buyer-facing request tables and private supplier-routing tables'
);
select ok(
  not has_table_privilege('anon','public.buyer_procurement_requests','SELECT')
  and not has_any_column_privilege('anon','public.buyer_procurement_requests','SELECT')
  and not has_table_privilege('anon','public.buyer_procurement_request_lines','SELECT')
  and not has_table_privilege('anon','private.platform_supplier_suborders','SELECT')
  and not has_table_privilege('anon','private.platform_supplier_suborder_lines','SELECT'),
  'anonymous users have no buyer request or supplier-routing access'
);
select ok(
  has_any_column_privilege('authenticated','public.buyer_procurement_requests','SELECT')
  and has_any_column_privilege('authenticated','public.buyer_procurement_request_lines','SELECT')
  and not has_table_privilege('authenticated','public.buyer_procurement_requests','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.buyer_procurement_request_lines','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','private.platform_supplier_suborders','SELECT')
  and not has_table_privilege('authenticated','private.platform_supplier_suborder_lines','SELECT'),
  'authenticated users can read only RLS-filtered request snapshots and cannot write or inspect private routing rows'
);
select ok(
  has_function_privilege('authenticated','public.create_buyer_procurement_request(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_buyer_procurement_request(uuid,uuid,uuid)','EXECUTE')
  and not (select prosecdef from pg_proc where oid='public.create_buyer_procurement_request(uuid,uuid,uuid)'::regprocedure)
  and has_function_privilege('authenticated','private.create_buyer_procurement_request(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','private.create_buyer_procurement_request(uuid,uuid,uuid)','EXECUTE')
  and (select prosecdef from pg_proc where oid='private.create_buyer_procurement_request(uuid,uuid,uuid)'::regprocedure),
  'only authenticated callers can reach the invoker RPC and its membership-checking private worker'
);
select is(
  (select count(*)::integer from pg_trigger
   where tgrelid in (
     'public.buyer_procurement_requests'::regclass,
     'public.buyer_procurement_request_lines'::regclass,
     'private.platform_supplier_suborders'::regclass,
     'private.platform_supplier_suborder_lines'::regclass
   ) and tgname like '%_immutable' and not tgisinternal),
  4,
  'all buyer snapshots and internal supplier routing rows have immutable update/delete guards'
);
select ok(
  exists (select 1 from pg_indexes where schemaname='public' and indexname='buyer_procurement_requests_org_location_idx')
  and exists (select 1 from pg_indexes where schemaname='public' and indexname='buyer_procurement_request_lines_offer_idx')
  and exists (select 1 from pg_indexes where schemaname='private' and indexname='platform_supplier_suborder_lines_request_line_fk_idx')
  and exists (select 1 from pg_indexes where schemaname='private' and indexname='platform_supplier_suborder_lines_suborder_fk_idx'),
  'tenant, catalog-offer and composite foreign-key lookup indexes are present'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select set_config('test.cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.cart_item_id',(
  select id::text from public.buyer_draft_cart_items
  where cart_id=current_setting('test.cart_id')::uuid order by catalog_offer_id limit 1
),true);
update public.buyer_draft_carts
   set buyer_location_id='53000000-0000-4000-8000-000000000001'
 where id=current_setting('test.cart_id')::uuid;
select set_config('test.request_id',public.create_buyer_procurement_request(
  '23000000-0000-4000-8000-000000000001',
  current_setting('test.cart_id')::uuid,
  '63000000-0000-4000-8000-000000000001'
)::text,true);
select is((select seller_type from public.buyer_procurement_requests where id=current_setting('test.request_id')::uuid),'platform','the buyer-facing request names the platform as seller');
select is((select request_status from public.buyer_procurement_requests where id=current_setting('test.request_id')::uuid),'submitted','the request is recorded only as submitted, not accepted');
select is((select submitted_by::text from public.buyer_procurement_requests where id=current_setting('test.request_id')::uuid),'13000000-0000-4000-8000-000000000002','the authenticated buyer manager is recorded as the explicit submitter');
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),1,'one buyer-facing parent request is persisted');
select ok((select submitted_at is not null from public.buyer_draft_carts where id=current_setting('test.cart_id')::uuid),'the source draft cart is frozen in the same transaction');
select is((select count(*)::integer from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid),2,'all source quantities become immutable buyer-facing snapshot lines');
select is(
  (select jsonb_build_object(
    'quantity',quantity,'title',title,'sell_unit_label',sell_unit_label,
    'units_per_sell_unit',units_per_sell_unit,'pack_amount',pack_amount,
    'pack_base_unit',pack_base_unit,'price_amount',price_amount,
    'currency',currency,'availability',availability,'catalog_offer_version',catalog_offer_version
  ) from public.buyer_procurement_request_lines
  where request_id=current_setting('test.request_id')::uuid
    and catalog_offer_id='43000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'quantity',4,'title','Flour','sell_unit_label','sack',
    'units_per_sell_unit',1,'pack_amount',5.000,
    'pack_base_unit','kg','price_amount',123.45,
    'currency','PLN','availability','in_stock','catalog_offer_version',1
  ),
  'line snapshot retains quantity, packaging, price, currency, availability and version'
);
select ok(
  (select line.price_observed_at=offer.price_observed_at
          and line.availability_observed_at=offer.availability_observed_at
   from public.buyer_procurement_request_lines as line
   join public.catalog_offers as offer on offer.id=line.catalog_offer_id
   where line.request_id=current_setting('test.request_id')::uuid
     and line.catalog_offer_id='43000000-0000-4000-8000-000000000001'),
  'line snapshot records the exact server-validated price and availability observation timestamps'
);
select is(
  public.create_buyer_procurement_request(
    '23000000-0000-4000-8000-000000000001',
    current_setting('test.cart_id')::uuid,
    '63000000-0000-4000-8000-000000000001'
  )::text,
  current_setting('test.request_id'),
  'idempotent replay returns the existing request without creating another'
);

reset role;
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),1,'idempotent replay leaves exactly one parent');
select is((select count(*)::integer from private.platform_supplier_suborders where buyer_request_id=current_setting('test.request_id')::uuid),2,'internal suborders are grouped by the two supplier tenants');
select is((select count(*)::integer from private.platform_supplier_suborder_lines where buyer_request_id=current_setting('test.request_id')::uuid),2,'each source line is linked to an internal supplier fulfillment line');
select is(
  (select count(*)::integer
   from private.platform_supplier_suborder_lines as subline
   join private.platform_supplier_suborders as suborder
     on suborder.id=subline.supplier_suborder_id
    and suborder.organization_id=subline.organization_id
    and suborder.buyer_request_id=subline.buyer_request_id
   join public.catalog_offers as offer on offer.id=subline.catalog_offer_id
   where subline.buyer_request_id=current_setting('test.request_id')::uuid
     and suborder.supplier_organization_id=offer.supplier_organization_id),
  2,
  'private suborders and lines retain the matching SupplierOffer/vendor linkage'
);
select throws_ok(
  $$update public.buyer_procurement_requests set source_list_name='Changed' where id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable buyer request trigger rejects privileged updates'
);
select throws_ok(
  $$delete from public.buyer_procurement_requests where id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable buyer request trigger rejects privileged deletes'
);
select throws_ok(
  $$update public.buyer_procurement_request_lines set quantity=5 where request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable buyer snapshot-line trigger rejects privileged updates'
);
select throws_ok(
  $$delete from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable buyer snapshot-line trigger rejects privileged deletes'
);
select throws_ok(
  $$update private.platform_supplier_suborders set created_at=clock_timestamp() where buyer_request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable internal suborder trigger rejects privileged updates'
);
select throws_ok(
  $$delete from private.platform_supplier_suborders where buyer_request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable internal suborder trigger rejects privileged deletes'
);
select throws_ok(
  $$update private.platform_supplier_suborder_lines set quantity=5 where buyer_request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable internal suborder-line trigger rejects privileged updates'
);
select throws_ok(
  $$delete from private.platform_supplier_suborder_lines where buyer_request_id=current_setting('test.request_id')::uuid$$,
  '55000',null,'the immutable internal suborder-line trigger rejects privileged deletes'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select set_config('test.conflict_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001'
)::text,true);
update public.buyer_draft_carts
   set buyer_location_id='53000000-0000-4000-8000-000000000001'
 where id=current_setting('test.conflict_cart_id')::uuid;
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.conflict_cart_id')::uuid,'63000000-0000-4000-8000-000000000001')$$,
  'P0001',null,'reusing an idempotency key for a different cart is rejected as a conflict'
);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.cart_id')::uuid,'63000000-0000-4000-8000-000000000002')$$,
  '55000',null,'a submitted cart cannot create a second request under a new key'
);
select throws_ok(
  $$select public.update_buyer_draft_cart_item_quantity('23000000-0000-4000-8000-000000000001',current_setting('test.cart_item_id')::uuid,6)$$,
  '55000',null,'the parent-locking quantity RPC refuses a frozen cart'
);
select throws_ok(
  $$select public.delete_buyer_draft_cart_item('23000000-0000-4000-8000-000000000001',current_setting('test.cart_item_id')::uuid)$$,
  '55000',null,'the parent-locking delete RPC refuses a frozen cart'
);
with changed as (
  update public.buyer_draft_carts
     set buyer_location_id=null
   where id=current_setting('test.cart_id')::uuid
   returning id
)
select is(
  (select count(*)::integer from changed),
  0,
  'RLS blocks a direct location update on a submitted cart'
);
select is(
  (select buyer_location_id::text from public.buyer_draft_carts
   where id=current_setting('test.cart_id')::uuid),
  '53000000-0000-4000-8000-000000000001',
  'the submitted cart location remains unchanged'
);
select throws_ok(
  $$update public.buyer_procurement_requests set request_status='accepted' where id=current_setting('test.request_id')::uuid$$,
  '42501',null,'authenticated clients cannot change request status or turn a request into an accepted order'
);
select throws_ok(
  $$delete from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid$$,
  '42501',null,'authenticated clients cannot alter or delete immutable buyer snapshot lines'
);
reset role;
create function pg_temp.reject_test_suborder_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode='P0001',message='synthetic downstream insert failure';
end;
$$;
create trigger test_fail_suborder_insert
  before insert on private.platform_supplier_suborders
  for each row execute function pg_temp.reject_test_suborder_insert();
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.conflict_cart_id')::uuid,'63000000-0000-4000-8000-000000000012')$$,
  'P0001',null,'a supplier-routing failure aborts the complete request transaction'
);
reset role;
drop trigger test_fail_suborder_insert on private.platform_supplier_suborders;
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),1,'atomic rollback leaves no second buyer-facing parent');
select is((select count(*)::integer from public.buyer_procurement_request_lines where organization_id='23000000-0000-4000-8000-000000000001'),2,'atomic rollback leaves no partial snapshot lines');
select is((select count(*)::integer from private.platform_supplier_suborders where buyer_request_id=(select id from public.buyer_procurement_requests where id=current_setting('test.request_id')::uuid)),2,'atomic rollback leaves original supplier suborders intact and no partial additions');
select is((select count(*)::integer from private.platform_supplier_suborder_lines where buyer_request_id=current_setting('test.request_id')::uuid),2,'atomic rollback leaves original supplier lines intact');
select ok((select submitted_at is null from public.buyer_draft_carts where id=current_setting('test.conflict_cart_id')::uuid),'failed supplier routing does not freeze the source draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);

-- A version change, an old price observation, MOQ/step, expiry and availability
-- are rechecked on the server; none of these attempts persist a partial request.
select set_config('test.stale_price_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.moq_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000003'
)::text,true);
select set_config('test.expired_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.availability_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.stale_version_cart_id',public.create_buyer_draft_cart(
  '23000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000006'
)::text,true);
update public.buyer_draft_carts set buyer_location_id='53000000-0000-4000-8000-000000000001'
 where id in (current_setting('test.stale_price_cart_id')::uuid,current_setting('test.moq_cart_id')::uuid,current_setting('test.expired_cart_id')::uuid,current_setting('test.availability_cart_id')::uuid,current_setting('test.stale_version_cart_id')::uuid);
reset role;
alter table public.catalog_offers disable trigger catalog_offers_touch_before_update;
update public.catalog_offers set price_observed_at=now()-interval '25 hours'
 where id='43000000-0000-4000-8000-000000000003';
alter table public.catalog_offers enable trigger catalog_offers_touch_before_update;
update public.catalog_offers set price_amount=price_amount+1
 where id='43000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.stale_price_cart_id')::uuid,'63000000-0000-4000-8000-000000000003')$$,
  '40001',null,'a price observation older than 24 hours blocks submission'
);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.stale_version_cart_id')::uuid,'63000000-0000-4000-8000-000000000004')$$,
  '40001',null,'a catalog version changed after cart creation blocks submission'
);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.moq_cart_id')::uuid,'63000000-0000-4000-8000-000000000005')$$,
  '40001',null,'quantity that violates MOQ or order step blocks submission'
);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.expired_cart_id')::uuid,'63000000-0000-4000-8000-000000000006')$$,
  '40001',null,'an expired price blocks submission'
);
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.availability_cart_id')::uuid,'63000000-0000-4000-8000-000000000007')$$,
  '40001',null,'supplier-reported out-of-stock availability blocks submission'
);
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),1,'all blocker failures roll back without partial buyer requests');
select ok((select submitted_at is null from public.buyer_draft_carts where id=current_setting('test.stale_price_cart_id')::uuid),'blocked carts remain editable and are not frozen');

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),1,'buyer viewer can read its tenant request');
select is((select count(*)::integer from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid),2,'buyer viewer can read its tenant snapshot lines');
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.stale_price_cart_id')::uuid,'63000000-0000-4000-8000-000000000008')$$,
  '42501',null,'viewer cannot submit a procurement request'
);
select throws_ok($$select * from private.platform_supplier_suborders$$,'42501',null,'buyer viewer cannot query internal supplier suborders');
select throws_ok($$select * from private.platform_supplier_suborder_lines$$,'42501',null,'buyer viewer cannot query internal supplier suborder lines');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),0,'another buyer tenant cannot read the request by guessed tenant id');
select is((select count(*)::integer from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid),0,'another buyer tenant cannot read snapshot lines by guessed request id');
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.conflict_cart_id')::uuid,'63000000-0000-4000-8000-000000000009')$$,
  '42501',null,'another buyer tenant cannot submit against the first tenant cart'
);
select throws_ok($$select * from private.platform_supplier_suborders$$,'42501',null,'other buyer cannot query internal supplier routing data');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from public.buyer_procurement_requests where organization_id='23000000-0000-4000-8000-000000000001'),0,'supplier cannot read buyer request records');
select is((select count(*)::integer from public.buyer_procurement_request_lines where request_id=current_setting('test.request_id')::uuid),0,'supplier cannot read buyer snapshot line details');
select throws_ok($$select * from private.platform_supplier_suborders$$,'42501',null,'supplier has no direct access to private platform routing rows');
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.conflict_cart_id')::uuid,'63000000-0000-4000-8000-000000000010')$$,
  '42501',null,'supplier cannot submit a buyer procurement request'
);
reset role;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.buyer_procurement_requests$$,'42501',null,'anonymous users cannot read buyer requests');
select throws_ok($$select * from public.buyer_procurement_request_lines$$,'42501',null,'anonymous users cannot read request snapshots');
select throws_ok(
  $$select public.create_buyer_procurement_request('23000000-0000-4000-8000-000000000001',current_setting('test.conflict_cart_id')::uuid,'63000000-0000-4000-8000-000000000011')$$,
  '42501',null,'anonymous users cannot create a request'
);
reset role;

select * from finish();
rollback;
