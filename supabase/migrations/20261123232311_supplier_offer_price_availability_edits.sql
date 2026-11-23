-- Allow catalog editors to maintain only the commercial terms that are already
-- protected by catalog_offers_update_catalog_operator RLS (approved supplier,
-- privileged membership, and same supplier tenant). Keep identity, product
-- details, publication state, and trigger-maintained fields outside this grant.
grant update (price_amount, currency, availability)
  on public.catalog_offers to authenticated;
