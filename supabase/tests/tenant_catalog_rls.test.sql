begin;

select plan(25);

-- Synthetic identities only. This test is meant for `supabase test db` on the
-- local Supabase stack; it never connects to a hosted project.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'buyer-one@example.test', '', now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'buyer-two@example.test', '', now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supplier-one@example.test', '', now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supplier-two@example.test', '', now()),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-editor@example.test', '', now()),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-operator@example.test', '', now())
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
insert into public.organizations (id, name, organization_type, created_by)
values ('20000000-0000-4000-8000-000000000001', 'Buyer One', 'buyer', auth.uid());
insert into public.buyer_locations (id, organization_id, name, address)
values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Kitchen A', 'Synthetic address A');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
insert into public.organizations (id, name, organization_type, created_by)
values ('20000000-0000-4000-8000-000000000002', 'Buyer Two', 'buyer', auth.uid());
insert into public.buyer_locations (id, organization_id, name, address)
values ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Kitchen B', 'Synthetic address B');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
insert into public.organizations (id, name, organization_type, created_by)
values ('20000000-0000-4000-8000-000000000003', 'Supplier One', 'supplier', auth.uid());
insert into public.supplier_profiles (organization_id, display_name)
values ('20000000-0000-4000-8000-000000000003', 'Supplier One');
update public.supplier_profiles
set verification_status = 'approved'
where organization_id = '20000000-0000-4000-8000-000000000003';
insert into public.catalog_offers (
  id, supplier_organization_id, supplier_sku, title, category, sell_unit_label,
  units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq,
  order_step, availability, is_published
) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'S1-PUB', 'Published flour', 'Grocery', 'bag 5 kg', 1, 5, 'kg', 3200, 'PLN', 1, 1, 'in_stock', true),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'S1-DRAFT', 'Draft rice', 'Grocery', 'bag 10 kg', 1, 10, 'kg', 7500, 'PLN', 1, 1, 'unknown', false);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
insert into public.organizations (id, name, organization_type, created_by)
values ('20000000-0000-4000-8000-000000000004', 'Supplier Two', 'supplier', auth.uid());
insert into public.supplier_profiles (organization_id, display_name)
values ('20000000-0000-4000-8000-000000000004', 'Supplier Two');
insert into public.catalog_offers (
  id, supplier_organization_id, supplier_sku, title, category, sell_unit_label,
  units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq,
  order_step, availability, is_published
) values
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', 'S2-DRAFT', 'Private oil', 'Oil', 'bottle 1 l', 1, 1, 'l', 900, 'PLN', 1, 1, 'low_stock', false);

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005', 'catalog_operator'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006', 'order_operator');

select ok(
  not has_table_privilege('anon', 'public.organizations', 'SELECT'),
  'anonymous users have no organization table grant'
);
select ok(
  not has_table_privilege('anon', 'public.catalog_offers', 'SELECT'),
  'anonymous users have no catalog table grant'
);
select ok(
  not has_function_privilege('anon', 'private.add_organization_owner()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.add_organization_owner()', 'EXECUTE')
    and has_function_privilege('authenticated', 'private.is_approved_supplier(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.is_approved_supplier(uuid)', 'EXECUTE'),
  'internal definer functions have only their intended execution grants'
);
select ok(
  not has_table_privilege('authenticated', 'public.organization_memberships', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot write or escalate organization memberships directly'
);
select is(
  (select count(*)::integer from public.organization_memberships where organization_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001' and role = 'owner'),
  1,
  'organization creation atomically provisions exactly one owner membership'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.organizations), 0, 'anonymous user sees no organizations');
select is((select count(*)::integer from public.catalog_offers), 0, 'anonymous user sees no published or private catalog rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.organizations where id = '20000000-0000-4000-8000-000000000001'), 1, 'buyer reads its own organization');
select is((select count(*)::integer from public.organizations where id = '20000000-0000-4000-8000-000000000002'), 0, 'buyer cannot read another tenant organization by guessed id');
select is((select count(*)::integer from public.organization_memberships), 1, 'membership read is restricted to the current user');
select is((select count(*)::integer from public.buyer_locations where id = '30000000-0000-4000-8000-000000000001'), 1, 'buyer reads its own delivery location');
select is((select count(*)::integer from public.buyer_locations where id = '30000000-0000-4000-8000-000000000002'), 0, 'buyer cannot read another tenant location or address');
select is((select count(*)::integer from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), 1, 'authenticated buyer can read a supplier-published offer');
select is((select count(*)::integer from public.catalog_offers where id in ('40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003')), 0, 'buyer cannot read unpublished offers, including another supplier draft');
select is((select count(*)::integer from public.supplier_profiles where organization_id = '20000000-0000-4000-8000-000000000003'), 1, 'published supplier profile is visible with its offer');
select is((select verification_status from public.supplier_profiles where organization_id = '20000000-0000-4000-8000-000000000003'), 'approved', 'approved supplier profile is visible with its offer');
select is((select count(*)::integer from public.supplier_profiles where organization_id = '20000000-0000-4000-8000-000000000004'), 0, 'buyer cannot view a pending supplier profile by guessed id');
select throws_ok(
  $$insert into public.buyer_locations (organization_id, name, address) values ('20000000-0000-4000-8000-000000000002', 'Forged kitchen', 'Synthetic foreign address')$$,
  '42501',
  'buyer cannot write a location under a foreign tenant id'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.catalog_offers where id = '40000000-0000-4000-8000-000000000002'), 1, 'catalog operator can read its supplier draft');
select lives_ok(
  $$insert into public.catalog_offers (supplier_organization_id, supplier_sku, title, category, sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq, order_step, availability) values ('20000000-0000-4000-8000-000000000003', 'S1-NEW', 'New product', 'Grocery', 'case', 1, 1, 'piece', 100, 'EUR', 1, 1, 'unknown')$$,
  'catalog operator can add an offer only for its supplier tenant'
);
select throws_ok(
  $$insert into public.catalog_offers (supplier_organization_id, supplier_sku, title, category, sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq, order_step, availability) values ('20000000-0000-4000-8000-000000000004', 'S2-FORGED', 'Foreign product', 'Grocery', 'case', 1, 1, 'piece', 100, 'EUR', 1, 1, 'unknown')$$,
  '42501',
  'catalog operator cannot write to another supplier tenant'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$insert into public.catalog_offers (supplier_organization_id, supplier_sku, title, category, sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq, order_step, availability) values ('20000000-0000-4000-8000-000000000003', 'S1-FORGED', 'Unauthorized product', 'Grocery', 'case', 1, 1, 'piece', 100, 'EUR', 1, 1, 'unknown')$$,
  '42501',
  'order operator cannot write catalog offers'
);
select is((select count(*)::integer from public.catalog_offers where id = '40000000-0000-4000-8000-000000000003'), 0, 'supplier member cannot read a different supplier draft');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$update public.supplier_profiles set verification_status = 'approved' where organization_id = '20000000-0000-4000-8000-000000000004'$$,
  '42501',
  'supplier owner cannot self-approve its verification status'
);
update public.catalog_offers
set is_published = true
where id = '40000000-0000-4000-8000-000000000003';
select is((select is_published from public.catalog_offers where id = '40000000-0000-4000-8000-000000000003'), false, 'pending supplier cannot publish an offer');
reset role;

select * from finish();
rollback;
