begin;
select plan(38);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) values
('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','imp-owner@example.test','',now()),
('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','imp-editor@example.test','',now()),
('81000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','imp-order@example.test','',now()),
('81000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','imp-none@example.test','',now()),
('81000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','imp-other@example.test','',now()) on conflict(id) do nothing;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
insert into public.organizations(id,name,organization_type,created_by) values
('82000000-0000-4000-8000-000000000001','Import Supplier A','supplier',auth.uid()),
('82000000-0000-4000-8000-000000000002','Import Supplier B','supplier',auth.uid());
insert into public.supplier_profiles(organization_id,display_name) values
('82000000-0000-4000-8000-000000000001','Import Supplier A'),('82000000-0000-4000-8000-000000000002','Import Supplier B');
insert into public.organization_memberships(organization_id,user_id,role) values
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','catalog_operator'),
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','order_operator'),
('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000005','catalog_operator');
select ok(not has_table_privilege('anon','public.catalog_products','SELECT') and not has_table_privilege('anon','public.supplier_catalog_imports','SELECT'),'anonymous has no direct table grants');
select ok(not has_table_privilege('authenticated','public.supplier_catalog_imports','SELECT') and not has_table_privilege('authenticated','public.supplier_catalog_imports','INSERT'),'authenticated has no direct job access');
select ok(has_table_privilege('authenticated','public.catalog_products','SELECT') and not has_table_privilege('authenticated','public.catalog_products','INSERT'),'products are client-readable only');
select ok(not has_function_privilege('anon','public.preview_supplier_catalog_import(uuid,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.apply_supplier_catalog_import(uuid,uuid)','EXECUTE') and has_function_privilege('authenticated','public.preview_supplier_catalog_import(uuid,uuid,jsonb)','EXECUTE'),'RPC grants are authenticated-only');
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','[]')$$,'42501',null,'no-membership cannot preview');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002','[]')$$,'42501',null,'order_operator cannot import');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000003','[]')$$,'42501',null,'cross-tenant forged organization is denied');
select throws_ok($$select public.apply_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000099')$$,'42501',null,'forged import id is denied');
-- Pending supplier may create new draft rows, with one distinct Product per SKU.
select is(public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000010', '[{"row_number":1,"values":{"sku":"PENDING-A","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]},{"row_number":2,"values":{"sku":"PENDING-B","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'status','previewed','pending supplier previews new rows');
create temporary table import_job_ids(id uuid);
insert into import_job_ids select (public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000011','[{"row_number":1,"values":{"sku":"PENDING-C","title":"Draft item","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'import_id')::uuid;
-- apply the two-item batch with a separate deterministically fetched job
select is((public.apply_supplier_catalog_import('82000000-0000-4000-8000-000000000001',(public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000010','[{"row_number":1,"values":{"sku":"PENDING-A","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]},{"row_number":2,"values":{"sku":"PENDING-B","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'import_id')::uuid)->>'status'),'applied','pending supplier can apply new rows atomically');
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku in ('PENDING-A','PENDING-B')),2,'two new supplier SKUs create two offers');
select is((select count(distinct product_id)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku in ('PENDING-A','PENDING-B')),2,'same-named new SKUs remain distinct products');
select ok((select bool_and(not is_published and product_id is not null) from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku in ('PENDING-A','PENDING-B')),'new offers are drafts linked to products');
select ok((select count(*)=2 from public.catalog_products p join public.catalog_offers o on o.product_id=p.id where o.supplier_organization_id='82000000-0000-4000-8000-000000000001' and o.supplier_sku in ('PENDING-A','PENDING-B')),'product visibility follows visible offer RLS');
select is((public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000012','[{"row_number":1,"values":{"sku":"PENDING-A","title":"Changed","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'status'),'blocked','pending existing SKU update is blocked');
create temporary table blocked_job(id uuid, status text);
insert into blocked_job
select (preview.result ->> 'import_id')::uuid, preview.result ->> 'status'
from (
  select public.preview_supplier_catalog_import(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000013',
    '[{"row_number":1,"values":{"sku":"DUP","title":"Dup","category":"C","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"1","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]},{"row_number":2,"values":{"sku":"DUP","title":"Dup","category":"C","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"1","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb
  ) as result
) as preview;
select is((select status from blocked_job), 'blocked', 'duplicate SKU rows block batch');
select throws_ok(format('select public.apply_supplier_catalog_import(%L,%L)', '82000000-0000-4000-8000-000000000001', (select id from blocked_job)), '23514', null, 'blocked preview cannot be applied');
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku='DUP'),0,'blocked batch creates no offers');
select is((public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000014','[{"row_number":1,"values":{"sku":"BAD","title":"","category":"C","sell_unit_label":"box","units_per_sell_unit":"many","pack_amount":"not-a-number","pack_base_unit":"bad","price_amount":"NaN","currency":"usd","moq":"1","order_step":"1","availability":"bad"},"client_errors":[]}]'::jsonb)->>'status'),'blocked','malformed numeric text safely blocks without casting errors');
select ok((public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000016','[{"row_number":1,"values":{"sku":"NO-PRICE","title":"Good","category":"C","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"1","pack_base_unit":"kg","price_amount":null,"currency":null,"moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->'rows'->0->'errors' @> '["invalid_price","invalid_currency"]'::jsonb),'server requires explicit positive price and currency');
select throws_ok(
  $$select public.preview_supplier_catalog_import(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000018',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('oversized', pg_catalog.repeat('x', 4000001))
    )
  )$$,
  '23514', 'invalid import payload', 'server rejects a serialized RPC payload above 4 MB'
);
select is(public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000017','[null]'::jsonb)->'rows'->0->>'row_number','1','malformed row gets a safe display row number');
select is((public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000015','[{"row_number":1,"values":{"sku":"CLIENTERR","title":"Good","category":"C","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"1","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":["bad header"]}]'::jsonb)->>'status'),'blocked','client parser errors block batch');
select is(public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000010','[{"row_number":1,"values":{"sku":"PENDING-A","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]},{"row_number":2,"values":{"sku":"PENDING-B","title":"Shared name","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'status','applied','same key and fingerprint replay is idempotent');
select throws_ok($$select public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000010','[{"row_number":1,"values":{"sku":"CHANGED","title":"Changed payload","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)$$,'P0001',null,'same idempotency key with changed payload is rejected');
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku in ('PENDING-A','PENDING-B')),2,'replay and reimport do not duplicate offers');
select is((select count(*)::integer from public.catalog_products where name='Shared name'),2,'reimport does not duplicate products');
-- Approval grants the catalog operator changed-existing-offer capability; product_id survives update.
reset role;
update public.supplier_profiles set verification_status='approved' where organization_id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
create temporary table approved_job(id uuid);
insert into approved_job select (public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000020','[{"row_number":1,"values":{"sku":"PENDING-A","title":"Renamed","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'import_id')::uuid;
select is((public.apply_supplier_catalog_import('82000000-0000-4000-8000-000000000001',(select id from approved_job))->>'status'),'applied','approved supplier applies an offer update');
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku='PENDING-A' and title='Renamed' and product_id is not null),1,'offer update retains its linked product');
select is((public.apply_supplier_catalog_import('82000000-0000-4000-8000-000000000001',(select id from approved_job))->>'status'),'applied','apply replay returns prior result');
select is((select count(*)::integer from public.catalog_products where name='Shared name'),2,'supplier-offer update does not mutate shared Product records');
-- A changed offer after preview makes the staged version stale and leaves the rest of the batch untouched.
create temporary table stale_job(id uuid);
insert into stale_job select (public.preview_supplier_catalog_import('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000021','[{"row_number":1,"values":{"sku":"PENDING-A","title":"Again","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]},{"row_number":2,"values":{"sku":"ROLLBACK-NEW","title":"New","category":"Produce","sell_unit_label":"box","units_per_sell_unit":"1","pack_amount":"2","pack_base_unit":"kg","price_amount":"10","currency":"KZT","moq":"1","order_step":"1","availability":"unknown"},"client_errors":[]}]'::jsonb)->>'import_id')::uuid;
reset role;
update public.catalog_offers set title='Concurrent edit' where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku='PENDING-A';
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok(format('select public.apply_supplier_catalog_import(%L,%L)', '82000000-0000-4000-8000-000000000001',(select id from stale_job)),'40001',null,'stale preview is rejected');
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku='ROLLBACK-NEW'),0,'stale batch performs no partial inserts');
reset role;
create function private.test_fail_late_catalog_offer_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.supplier_sku = 'ROLLBACK-LATE' then
    raise exception using errcode = '23514', message = 'forced late insert failure';
  end if;
  return new;
end;
$$;
create trigger supplier_catalog_import_test_late_failure
before insert on public.catalog_offers
for each row execute function private.test_fail_late_catalog_offer_insert();
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
create temporary table late_failure_job(id uuid);
insert into late_failure_job
select (public.preview_supplier_catalog_import(
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000030',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'row_number', 1,
      'values', pg_catalog.jsonb_build_object(
        'sku','ROLLBACK-FIRST','title','Late rollback first','category','Produce',
        'sell_unit_label','box','units_per_sell_unit','1','pack_amount','2',
        'pack_base_unit','kg','price_amount','10','currency','KZT','moq','1',
        'order_step','1','availability','unknown'
      ),
      'client_errors', pg_catalog.jsonb_build_array()
    ),
    pg_catalog.jsonb_build_object(
      'row_number', 2,
      'values', pg_catalog.jsonb_build_object(
        'sku','ROLLBACK-LATE','title','Late rollback second','category','Produce',
        'sell_unit_label','box','units_per_sell_unit','1','pack_amount','2',
        'pack_base_unit','kg','price_amount','10','currency','KZT','moq','1',
        'order_step','1','availability','unknown'
      ),
      'client_errors', pg_catalog.jsonb_build_array()
    )
  )
)->>'import_id')::uuid;
select throws_ok(
  format('select public.apply_supplier_catalog_import(%L,%L)',
    '82000000-0000-4000-8000-000000000001', (select id from late_failure_job)),
  '23514', 'forced late insert failure', 'late SQL exception aborts the complete apply call'
);
reset role;
select is((select count(*)::integer from public.catalog_offers where supplier_organization_id='82000000-0000-4000-8000-000000000001' and supplier_sku in ('ROLLBACK-FIRST','ROLLBACK-LATE')),0,'late failure rolls back offers inserted earlier in the batch');
select is((select count(*)::integer from public.catalog_products where name in ('Late rollback first','Late rollback second')),0,'late failure rolls back all Product inserts');
select is((select status from public.supplier_catalog_imports where id=(select id from late_failure_job)),'previewed','failed job remains unapplied after late SQL error');
select ok((select result is null and applied_at is null from public.supplier_catalog_imports where id=(select id from late_failure_job)),'failed job has no applied result or timestamp');
drop trigger supplier_catalog_import_test_late_failure on public.catalog_offers;
drop function private.test_fail_late_catalog_offer_insert();
select * from finish();
rollback;
