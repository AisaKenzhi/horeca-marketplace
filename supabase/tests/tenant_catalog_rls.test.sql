begin;

select plan(54);

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
  not has_table_privilege('authenticated', 'public.organization_memberships', 'INSERT')
    and not has_table_privilege('authenticated', 'public.organization_memberships', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.organization_memberships', 'DELETE'),
  'authenticated users cannot write or escalate organization memberships directly'
);
select is(
  (select count(*)::integer from public.organization_memberships where organization_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000001' and role = 'owner'),
  1,
  'organization creation atomically provisions exactly one owner membership'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select lives_ok(
  $$insert into public.organizations (name, organization_type, created_by) values ('New Buyer', 'buyer', auth.uid())$$,
  'authenticated user can create an organization for itself'
);
select is(
  (select created_by from public.organizations where created_by = auth.uid() and name = 'New Buyer'),
  '10000000-0000-4000-8000-000000000006'::uuid,
  'new organization records the authenticated creator'
);
select is(
  (select count(*)::integer from public.organization_memberships where organization_id = (select id from public.organizations where created_by = auth.uid() and name = 'New Buyer') and user_id = auth.uid() and role = 'owner'),
  1,
  'new organization receives its creator as owner'
);
select throws_ok(
  $$insert into public.organizations (name, organization_type, created_by) values ('Forged Buyer', 'buyer', '10000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'authenticated user cannot forge another organization creator'
);
select is(
  (select count(*)::integer from public.organizations where name = 'Forged Buyer' and created_by = '10000000-0000-4000-8000-000000000001'),
  0,
  'forged organization creation leaves no row'
);
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.organizations$$,
  '42501',
  null,
  'anonymous user cannot query organizations without a table grant'
);
select throws_ok(
  $$select * from public.catalog_offers$$,
  '42501',
  null,
  'anonymous user cannot query catalog offers without a table grant'
);
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
  null,
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
  null,
  'catalog operator cannot write to another supplier tenant'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$insert into public.catalog_offers (supplier_organization_id, supplier_sku, title, category, sell_unit_label, units_per_sell_unit, pack_amount, pack_base_unit, price_amount, currency, moq, order_step, availability) values ('20000000-0000-4000-8000-000000000003', 'S1-FORGED', 'Unauthorized product', 'Grocery', 'case', 1, 1, 'piece', 100, 'EUR', 1, 1, 'unknown')$$,
  '42501',
  null,
  'order operator cannot write catalog offers'
);
select is((select count(*)::integer from public.catalog_offers where id = '40000000-0000-4000-8000-000000000003'), 0, 'supplier member cannot read a different supplier draft');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$update public.supplier_profiles set verification_status = 'approved' where organization_id = '20000000-0000-4000-8000-000000000004'$$,
  '42501',
  null,
  'supplier owner cannot self-approve its verification status'
);
update public.catalog_offers
set is_published = true
where id = '40000000-0000-4000-8000-000000000003';
select is((select is_published from public.catalog_offers where id = '40000000-0000-4000-8000-000000000003'), false, 'pending supplier cannot publish an offer');
reset role;

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('organizations', 'organization_memberships', 'buyer_locations', 'supplier_profiles', 'catalog_offers'))
  and (select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('organizations', 'organization_memberships', 'buyer_locations', 'supplier_profiles', 'catalog_offers')),
  'RLS is enabled on all five exposed public tables'
);
select ok(
  not has_table_privilege('anon', 'public.organizations', 'SELECT')
  and not has_table_privilege('anon', 'public.organizations', 'INSERT')
  and not has_table_privilege('anon', 'public.organizations', 'UPDATE')
  and not has_table_privilege('anon', 'public.organizations', 'DELETE')
  and not has_table_privilege('anon', 'public.organization_memberships', 'SELECT')
  and not has_table_privilege('anon', 'public.organization_memberships', 'INSERT')
  and not has_table_privilege('anon', 'public.organization_memberships', 'UPDATE')
  and not has_table_privilege('anon', 'public.organization_memberships', 'DELETE')
  and not has_table_privilege('anon', 'public.buyer_locations', 'SELECT')
  and not has_table_privilege('anon', 'public.buyer_locations', 'INSERT')
  and not has_table_privilege('anon', 'public.buyer_locations', 'UPDATE')
  and not has_table_privilege('anon', 'public.buyer_locations', 'DELETE')
  and not has_table_privilege('anon', 'public.supplier_profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.supplier_profiles', 'INSERT')
  and not has_table_privilege('anon', 'public.supplier_profiles', 'UPDATE')
  and not has_table_privilege('anon', 'public.supplier_profiles', 'DELETE')
  and not has_table_privilege('anon', 'public.catalog_offers', 'SELECT')
  and not has_table_privilege('anon', 'public.catalog_offers', 'INSERT')
  and not has_table_privilege('anon', 'public.catalog_offers', 'UPDATE')
  and not has_table_privilege('anon', 'public.catalog_offers', 'DELETE')
  and not has_any_column_privilege('anon', 'public.organizations', 'SELECT')
  and not has_any_column_privilege('anon', 'public.organizations', 'INSERT')
  and not has_any_column_privilege('anon', 'public.organizations', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.organization_memberships', 'SELECT')
  and not has_any_column_privilege('anon', 'public.organization_memberships', 'INSERT')
  and not has_any_column_privilege('anon', 'public.organization_memberships', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.buyer_locations', 'SELECT')
  and not has_any_column_privilege('anon', 'public.buyer_locations', 'INSERT')
  and not has_any_column_privilege('anon', 'public.buyer_locations', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.supplier_profiles', 'SELECT')
  and not has_any_column_privilege('anon', 'public.supplier_profiles', 'INSERT')
  and not has_any_column_privilege('anon', 'public.supplier_profiles', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.catalog_offers', 'SELECT')
  and not has_any_column_privilege('anon', 'public.catalog_offers', 'INSERT')
  and not has_any_column_privilege('anon', 'public.catalog_offers', 'UPDATE'),
  'anon has no table or column grants on any exposed tenant table'
);
select ok(
  has_table_privilege('authenticated', 'public.buyer_locations', 'SELECT')
  and has_table_privilege('authenticated', 'public.buyer_locations', 'DELETE')
  and has_column_privilege('authenticated', 'public.buyer_locations', 'organization_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.buyer_locations', 'organization_id', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.buyer_locations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.buyer_locations', 'UPDATE')
  and has_column_privilege('authenticated', 'public.supplier_profiles', 'display_name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.supplier_profiles', 'verification_status', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.organization_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organization_memberships', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.organization_memberships', 'DELETE')
  and has_column_privilege('authenticated', 'public.catalog_offers', 'is_published', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.catalog_offers', 'title', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.catalog_offers', 'price_amount', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.catalog_offers', 'supplier_organization_id', 'UPDATE'),
  'authenticated grants are bounded to intended tenant operations and protected columns'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into public.buyer_locations (organization_id, name, address) values ('20000000-0000-4000-8000-000000000001', 'Kitchen C', 'Synthetic address C')$$,
  'buyer owner can add a location within its own organization'
);
select lives_ok(
  $$update public.buyer_locations set name = 'Kitchen A Updated' where id = '30000000-0000-4000-8000-000000000001'$$,
  'buyer owner can update a location within its own organization'
);
select is((select name from public.buyer_locations where id = '30000000-0000-4000-8000-000000000001'), 'Kitchen A Updated', 'own location update persists');
select lives_ok(
  $$delete from public.buyer_locations where id = '30000000-0000-4000-8000-000000000001'$$,
  'buyer owner can delete a location within its own organization'
);
select is((select count(*)::integer from public.buyer_locations where id = '30000000-0000-4000-8000-000000000001'), 0, 'own location deletion persists');
select throws_ok(
  $$update public.buyer_locations set organization_id = '20000000-0000-4000-8000-000000000002' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'buyer cannot change a location tenant assignment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into public.buyer_locations (organization_id, name, address) values ('20000000-0000-4000-8000-000000000001', 'Supplier location', 'Synthetic address')$$,
  '42501',
  null,
  'supplier owner cannot create a buyer location'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select lives_ok(
  $$update public.supplier_profiles set display_name = 'Supplier Two Updated' where organization_id = '20000000-0000-4000-8000-000000000004'$$,
  'supplier owner can update its profile display name'
);
select is((select display_name from public.supplier_profiles where organization_id = '20000000-0000-4000-8000-000000000004'), 'Supplier Two Updated', 'supplier profile display name update persists');
select lives_ok(
  $$update public.supplier_profiles set display_name = 'Forged' where organization_id = '20000000-0000-4000-8000-000000000003'$$,
  'supplier cannot edit a foreign profile; RLS filters the row'
);
reset role;
select is((select display_name from public.supplier_profiles where organization_id = '20000000-0000-4000-8000-000000000003'), 'Supplier One', 'foreign supplier profile remains unchanged after attempted edit');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$update public.catalog_offers set is_published = false where id = '40000000-0000-4000-8000-000000000001'$$,
  'approved supplier catalog operator can unpublish its offer'
);
select is((select is_published from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), false, 'offer publication state update persists');
select lives_ok(
  $$update public.catalog_offers set is_published = true where id = '40000000-0000-4000-8000-000000000001'$$,
  'approved supplier catalog operator can publish its offer'
);
select is((select is_published from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), true, 'approved supplier offer is published');
select is((select version from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), 3, 'catalog publication changes increment offer version');
select ok((select updated_at > created_at from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), 'catalog publication changes advance updated_at');
select throws_ok(
  $$update public.catalog_offers set price_amount = 3300 where id = '40000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'catalog operator cannot change price without the corresponding column grant'
);
select throws_ok(
  $$update public.catalog_offers set supplier_organization_id = '20000000-0000-4000-8000-000000000004' where id = '40000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'catalog operator cannot reassign an offer to another supplier tenant'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select lives_ok(
  $$update public.catalog_offers set is_published = false where id = '40000000-0000-4000-8000-000000000001'$$,
  'order operator cannot modify catalog offers; RLS filters the row'
);
reset role;
select is((select is_published from public.catalog_offers where id = '40000000-0000-4000-8000-000000000001'), true, 'order-operator attempt leaves the published catalog offer unchanged');

select * from finish();
rollback;
