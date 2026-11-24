begin;
select no_plan();

-- Synthetic-only identities, tenants, catalog rows and procurement requests.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-buyer-owner@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-buyer-manager@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-buyer-viewer@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-supplier-a-owner@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-supplier-a-orders@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-supplier-a-catalog@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-supplier-b-owner@test.invalid','',now()),
  ('71000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','workflow-other-buyer@test.invalid','',now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('72000000-0000-4000-8000-000000000001','Workflow buyer','buyer',auth.uid());
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('72000000-0000-4000-8000-000000000002','Workflow supplier A','supplier',auth.uid());
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000007',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('72000000-0000-4000-8000-000000000003','Workflow supplier B','supplier',auth.uid());
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000008',true);
insert into public.organizations (id,name,organization_type,created_by)
values ('72000000-0000-4000-8000-000000000004','Workflow other buyer','buyer',auth.uid());

insert into public.organization_memberships (organization_id,user_id,role) values
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','buyer'),
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','viewer'),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000005','order_operator'),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000006','catalog_operator');
insert into public.buyer_locations (id,organization_id,name,address) values
  ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Synthetic kitchen','Synthetic address');
insert into public.supplier_profiles (organization_id,display_name) values
  ('72000000-0000-4000-8000-000000000002','Supplier A'),
  ('72000000-0000-4000-8000-000000000003','Supplier B');
update public.supplier_profiles set verification_status='approved'
where organization_id in ('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000003');

insert into public.catalog_offers (
  id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,
  units_per_sell_unit,pack_amount,pack_base_unit,price_amount,currency,moq,
  order_step,availability,price_valid_until,is_published
) values
  ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','WF-A1','Synthetic flour','Grocery','sack',1,5,'kg',123.4500,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  ('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','WF-A2','Synthetic oil','Grocery','bottle',1,1,'l',200.0000,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  ('74000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000002','WF-A3','Synthetic rice','Grocery','bag',1,2,'kg',45.0000,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  ('74000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000003','WF-B1','Synthetic beans','Grocery','case',1,1,'kg',75.0000,'PLN',1,1,'in_stock',now()+interval '1 day',true);

insert into public.buyer_procurement_lists (id,organization_id,name,created_by) values
  ('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','Workflow main','71000000-0000-4000-8000-000000000001'),
  ('75000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','Workflow reject case','71000000-0000-4000-8000-000000000001');
insert into public.buyer_procurement_list_items (organization_id,list_id,catalog_offer_id,quantity) values
  ('72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',4),
  ('72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',2),
  ('72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000004',2),
  ('72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000003',1);

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select set_config('test.main_cart_id',public.create_buyer_draft_cart(
  '72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001'
)::text,true);
update public.buyer_draft_carts set buyer_location_id='73000000-0000-4000-8000-000000000001'
where id=current_setting('test.main_cart_id')::uuid;
select set_config('test.main_request_id',public.create_buyer_procurement_request(
  '72000000-0000-4000-8000-000000000001',current_setting('test.main_cart_id')::uuid,
  '76000000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.reject_cart_id',public.create_buyer_draft_cart(
  '72000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002'
)::text,true);
update public.buyer_draft_carts set buyer_location_id='73000000-0000-4000-8000-000000000001'
where id=current_setting('test.reject_cart_id')::uuid;
select set_config('test.reject_request_id',public.create_buyer_procurement_request(
  '72000000-0000-4000-8000-000000000001',current_setting('test.reject_cart_id')::uuid,
  '76000000-0000-4000-8000-000000000002'
)::text,true);
reset role;

select set_config('test.suborder_a_id',(
  select id::text from private.platform_supplier_suborders
  where buyer_request_id=current_setting('test.main_request_id')::uuid
    and supplier_organization_id='72000000-0000-4000-8000-000000000002'
),true);
select set_config('test.suborder_b_id',(
  select id::text from private.platform_supplier_suborders
  where buyer_request_id=current_setting('test.main_request_id')::uuid
    and supplier_organization_id='72000000-0000-4000-8000-000000000003'
),true);
select set_config('test.suborder_a_reject_id',(
  select id::text from private.platform_supplier_suborders
  where buyer_request_id=current_setting('test.reject_request_id')::uuid
    and supplier_organization_id='72000000-0000-4000-8000-000000000002'
),true);
select set_config('test.line_a1_id',(
  select buyer_request_line_id::text from private.platform_supplier_suborder_lines
  where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid
    and catalog_offer_id='74000000-0000-4000-8000-000000000001'
),true);
select set_config('test.line_a2_id',(
  select buyer_request_line_id::text from private.platform_supplier_suborder_lines
  where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid
    and catalog_offer_id='74000000-0000-4000-8000-000000000002'
),true);
select set_config('test.proposal_deadline',(clock_timestamp()+interval '1 day')::text,true);

select is((select count(*)::integer from private.platform_supplier_suborder_workflows),3,
  'each routed private suborder gets a workflow in the original request transaction');
select is((select count(*)::integer from private.platform_supplier_suborder_workflows where status='awaiting_supplier' and workflow_version=1 and current_terms_version=1),3,
  'new workflows begin pending supplier response at workflow/terms version 1');
select is((select count(*)::integer from private.platform_supplier_suborder_terms),3,
  'version 1 is initialized for each suborder');
select is((select count(*)::integer from private.platform_supplier_suborder_workflow_events where event_type='request_routed'),3,
  'request routing itself is recorded in the audit');
select ok(
  not has_table_privilege('authenticated','private.platform_supplier_suborder_workflows','SELECT')
  and not has_table_privilege('authenticated','private.platform_supplier_suborder_terms','SELECT')
  and not has_table_privilege('authenticated','private.platform_supplier_suborder_workflow_events','SELECT')
  and not has_table_privilege('anon','private.platform_supplier_suborder_workflows','SELECT')
  and not has_function_privilege('anon','public.list_supplier_suborders(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.list_supplier_suborders(uuid)','EXECUTE'),
  'private tables have no client grants and public RPCs are authenticated-only'
);
select ok(
  not (select prosecdef from pg_proc where oid='public.list_supplier_suborders(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.accept_supplier_suborder(uuid,uuid,integer,uuid)'::regprocedure),
  'public RPC wrappers run as invokers, not as elevated function owners'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from public.list_supplier_suborders('72000000-0000-4000-8000-000000000002')),2,
  'supplier order_operator sees only its two addressed suborders');
select is((select jsonb_array_length(lines)::integer from public.list_supplier_suborders('72000000-0000-4000-8000-000000000002') where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),2,
  'supplier view includes only the two lines of its own branch');
select ok(
  not exists (
    select 1 from jsonb_object_keys((select to_jsonb(view_row) from public.list_supplier_suborders('72000000-0000-4000-8000-000000000002') as view_row limit 1)) as key
    where key in ('buyer_organization_id','buyer_request_id','buyer_location_id')
  ),
  'supplier response does not expose buyer tenant, parent request or location identifiers'
);
select throws_ok(
  $$select * from public.list_supplier_suborders('72000000-0000-4000-8000-000000000003')$$,
  '42501',null,'supplier cannot select another supplier tenant in the list RPC'
);
select throws_ok(
  $$select public.accept_supplier_suborder('72000000-0000-4000-8000-000000000002',current_setting('test.suborder_b_id')::uuid,1,'77000000-0000-4000-8000-000000000001')$$,
  'P0002',null,'supplier cannot address another supplier suborder by guessed ID'
);
select throws_ok($$select * from private.platform_supplier_suborder_workflows$$,'42501',null,
  'supplier cannot directly query private workflow rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000006',true);
select throws_ok(
  $$select * from public.list_supplier_suborders('72000000-0000-4000-8000-000000000002')$$,
  '42501',null,'catalog_operator cannot read order workflow data'
);
reset role;

-- A synthetic audit sink failure must roll back the new terms, current state,
-- event, and idempotency receipt as one transaction.
create function pg_temp.fail_supplier_workflow_proposal_audit()
returns trigger
language plpgsql
as $$
begin
  if new.event_type='supplier_version_proposed' then
    raise exception using errcode='P0001',message='synthetic workflow audit failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_supplier_workflow_proposal_audit
  before insert on private.platform_supplier_suborder_workflow_events
  for each row execute function pg_temp.fail_supplier_workflow_proposal_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select throws_ok(
  $$select public.propose_supplier_suborder_version(
    '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_id')::uuid,
    'Synthetic proposal for rollback',current_setting('test.proposal_deadline')::timestamptz,
    jsonb_build_array(
      jsonb_build_object('buyer_request_line_id',current_setting('test.line_a1_id')::uuid,'quantity',4,'price_amount','130.0000'),
      jsonb_build_object('buyer_request_line_id',current_setting('test.line_a2_id')::uuid,'quantity',2,'price_amount','200.0000')
    ),1,'78000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',null,'audit insert failure aborts the workflow command'
);
reset role;
drop trigger test_fail_supplier_workflow_proposal_audit on private.platform_supplier_suborder_workflow_events;
select is((select status from private.platform_supplier_suborder_workflows where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),
  'awaiting_supplier','failed action rolls back the workflow state');
select is((select count(*)::integer from private.platform_supplier_suborder_terms where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),1,
  'failed action rolls back the proposed terms version');
select is((select count(*)::integer from private.platform_supplier_suborder_workflow_events where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),1,
  'failed action leaves only the original routing audit event');
select is((select count(*)::integer from private.platform_supplier_suborder_action_idempotency where idempotency_key='78000000-0000-4000-8000-000000000001'),0,
  'failed action does not consume its idempotency key');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select set_config('test.proposal_receipt',public.propose_supplier_suborder_version(
  '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_id')::uuid,
  'Synthetic supplier quote update',current_setting('test.proposal_deadline')::timestamptz,
  jsonb_build_array(
    jsonb_build_object('buyer_request_line_id',current_setting('test.line_a1_id')::uuid,'quantity',4,'price_amount','130.0000'),
    jsonb_build_object('buyer_request_line_id',current_setting('test.line_a2_id')::uuid,'quantity',3,'price_amount','200.0000')
  ),1,'78000000-0000-4000-8000-000000000002'
)::text,true);
select is((current_setting('test.proposal_receipt')::jsonb ->> 'status'),'awaiting_buyer_decision',
  'supplier proposal waits for an explicit buyer decision');
select is((current_setting('test.proposal_receipt')::jsonb ->> 'workflow_version')::integer,2,
  'successful supplier proposal increments workflow version');
select is((current_setting('test.proposal_receipt')::jsonb ->> 'current_terms_version')::integer,2,
  'supplier proposal creates terms version 2');
select set_config('test.proposal_replay',public.propose_supplier_suborder_version(
  '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_id')::uuid,
  'Synthetic supplier quote update',current_setting('test.proposal_deadline')::timestamptz,
  jsonb_build_array(
    jsonb_build_object('buyer_request_line_id',current_setting('test.line_a1_id')::uuid,'quantity',4,'price_amount','130.0000'),
    jsonb_build_object('buyer_request_line_id',current_setting('test.line_a2_id')::uuid,'quantity',3,'price_amount','200.0000')
  ),1,'78000000-0000-4000-8000-000000000002'
)::text,true);
select is((current_setting('test.proposal_replay')::jsonb ->> 'replayed')::boolean,true,
  'same supplier idempotency key and payload returns the original receipt');
select throws_ok(
  $$select public.propose_supplier_suborder_version(
    '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_id')::uuid,
    'Changed payload with reused key',current_setting('test.proposal_deadline')::timestamptz,
    jsonb_build_array(
      jsonb_build_object('buyer_request_line_id',current_setting('test.line_a1_id')::uuid,'quantity',4,'price_amount','130.0000'),
      jsonb_build_object('buyer_request_line_id',current_setting('test.line_a2_id')::uuid,'quantity',3,'price_amount','200.0000')
    ),1,'78000000-0000-4000-8000-000000000002'
  )$$,
  'P0001',null,'reusing an idempotency key for changed content is rejected'
);
select throws_ok(
  $$select public.accept_supplier_suborder(
    '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_id')::uuid,1,
    '78000000-0000-4000-8000-000000000003'
  )$$,
  '40001',null,'a stale concurrent supplier writer loses on expected workflow version'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select is((select current_terms_version from public.list_buyer_supplier_suborder_workflows(
  '72000000-0000-4000-8000-000000000001',current_setting('test.main_request_id')::uuid
) where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),2,
  'buyer viewer can read the exact current proposal for its own parent request');
select throws_ok(
  $$select public.accept_buyer_supplier_suborder_version(
    '72000000-0000-4000-8000-000000000001',current_setting('test.suborder_a_id')::uuid,2,2,
    '79000000-0000-4000-8000-000000000001'
  )$$,
  '42501',null,'buyer viewer cannot accept a proposal');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select public.accept_buyer_supplier_suborder_version(
    '72000000-0000-4000-8000-000000000001',current_setting('test.suborder_a_id')::uuid,1,2,
    '79000000-0000-4000-8000-000000000002'
  )$$,
  '40001',null,'buyer cannot decide an older terms version');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000008',true);
select throws_ok(
  $$select * from public.list_buyer_supplier_suborder_workflows(
    '72000000-0000-4000-8000-000000000004',current_setting('test.main_request_id')::uuid
  )$$,
  'P0002',null,'another buyer tenant cannot read the parent workflow by guessed ID'
);
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select set_config('test.buyer_receipt',public.accept_buyer_supplier_suborder_version(
  '72000000-0000-4000-8000-000000000001',current_setting('test.suborder_a_id')::uuid,2,2,
  '79000000-0000-4000-8000-000000000003'
)::text,true);
select is((current_setting('test.buyer_receipt')::jsonb ->> 'status'),'buyer_accepted',
  'buyer explicitly accepts the exact current proposal');
select is((current_setting('test.buyer_receipt')::jsonb ->> 'workflow_version')::integer,3,
  'buyer decision increments workflow version only');
select is((current_setting('test.buyer_receipt')::jsonb ->> 'current_terms_version')::integer,2,
  'buyer decision preserves the selected terms version');
select is((public.accept_buyer_supplier_suborder_version(
  '72000000-0000-4000-8000-000000000001',current_setting('test.suborder_a_id')::uuid,2,2,
  '79000000-0000-4000-8000-000000000003'
) ->> 'replayed')::boolean,true,
  'buyer retry returns the accepted-version receipt without another transition');
select throws_ok(
  $$select public.accept_buyer_supplier_suborder_version(
    '72000000-0000-4000-8000-000000000001',current_setting('test.suborder_a_id')::uuid,2,3,
    '79000000-0000-4000-8000-000000000003'
  )$$,
  'P0001',null,'buyer idempotency key cannot be reused with a different expected version'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000007',true);
select is((select count(*)::integer from public.list_supplier_suborders('72000000-0000-4000-8000-000000000003')),1,
  'supplier B sees only its own suborder');
select set_config('test.supplier_b_receipt',public.accept_supplier_suborder(
  '72000000-0000-4000-8000-000000000003',current_setting('test.suborder_b_id')::uuid,1,
  '78000000-0000-4000-8000-000000000004'
)::text,true);
select is((current_setting('test.supplier_b_receipt')::jsonb ->> 'status'),'supplier_accepted',
  'supplier owner can explicitly accept the original terms for its own suborder');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select set_config('test.supplier_rejection_receipt',public.reject_supplier_suborder(
  '72000000-0000-4000-8000-000000000002',current_setting('test.suborder_a_reject_id')::uuid,
  'Synthetic reason: unavailable in this test fixture',1,'78000000-0000-4000-8000-000000000005'
)::text,true);
select is((current_setting('test.supplier_rejection_receipt')::jsonb ->> 'status'),'supplier_rejected',
  'supplier can explicitly reject its own original terms with a reason');
reset role;

select is((select request_status from public.buyer_procurement_requests where id=current_setting('test.main_request_id')::uuid),
  'submitted','supplier and buyer responses do not change the parent buyer-request status');
select is((select price_amount from public.buyer_procurement_request_lines
  where request_id=current_setting('test.main_request_id')::uuid
    and catalog_offer_id='74000000-0000-4000-8000-000000000001'),123.4500::numeric,
  'the immutable buyer snapshot price remains unchanged after proposal and decision');
select is((select count(*)::integer from private.platform_supplier_suborder_terms
  where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),2,
  'the original terms and proposed terms remain as two immutable versions');
select is((select count(*)::integer from private.platform_supplier_suborder_workflow_events
  where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid),3,
  'proposal and exact-version buyer decision are both present in the audit');
select throws_ok(
  $$update private.platform_supplier_suborder_terms set reason='edited' where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid and terms_version=2$$,
  '55000',null,'terms history rejects updates');
select throws_ok(
  $$delete from private.platform_supplier_suborder_term_lines where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid$$,
  '55000',null,'terms-line history rejects deletes');
select throws_ok(
  $$update private.platform_supplier_suborder_workflow_events set reason='edited' where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid$$,
  '55000',null,'workflow audit rejects updates');
select throws_ok(
  $$delete from private.platform_supplier_suborder_action_idempotency where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid$$,
  '55000',null,'idempotency receipts reject deletes');
select throws_ok(
  $$update private.platform_supplier_suborder_workflows set status='awaiting_supplier' where supplier_suborder_id=current_setting('test.suborder_a_id')::uuid$$,
  '42501',null,'workflow current state cannot be directly updated outside its worker');

select * from finish();
rollback;
