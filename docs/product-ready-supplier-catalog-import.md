# Persistent supplier catalog CSV import

## Import flow

A supplier catalog operator chooses a CSV file, maps its header columns to the supported offer fields, and requests a server-side preview. The preview reports each row as **create**, **update**, **unchanged**, or **error**, with counts and row-level changes or validation reasons. The interface enables apply only when the staged preview has no blocking errors. Apply writes the entire eligible batch in one database transaction; an exception or stale offer version rolls back every write in the batch.

The local parser is a convenience, not an authorization or validation boundary. The database RPC revalidates the submitted values and permissions before staging and again before applying.

## Supported data and limits

Every row must include supplier SKU, title, category, sell-unit label, units per sell unit, pack amount, pack base unit, positive price, explicit currency code, MOQ, and order step. Availability is optional and defaults to `unknown`. Pack base units are `kg`, `l`, or `piece`; values are not inferred or converted. Currency must be supplied as three uppercase letters, with no market-specific currency default or conversion.

Files are limited to 512,000 UTF-8 bytes, 2,000 data rows, 32 columns, and 4,096 characters per cell. Quoting follows CSV double-quote escaping, including quoted commas and newlines. Malformed input, inconsistent row widths, duplicate mappings, duplicate SKUs within one file, and invalid numeric values block the batch. Values are rendered as text; the import does not execute formulas or macros.

## Roles, approval, and tenant isolation

Only an owner, admin, or `catalog_operator` of the selected supplier organization may preview or apply an import. The server checks the organization type, current membership and supplier verification status; buyer organizations and order-only roles are denied. A pending supplier can create new unpublished draft offers, but cannot update an existing offer until approved. Existing SKU identity is scoped by supplier organization, so another tenant's SKU is neither looked up nor modified.

The staging job is private to its supplier organization. Reusing its idempotency key with the same payload returns the saved preview/result; reusing it with different content is rejected. Re-importing an already-applied SKU previews as unchanged or update and does not create another offer. Apply checks the offer version captured in the preview and rejects stale work without partial writes.

## Product and offer records

An imported new SKU creates a `catalog_products` row and a supplier-owned `catalog_offers` row linked by `product_id`; the offer starts unpublished. An update changes only the supplier's offer terms and metadata. It does not mutate the linked Product record, which remains a separate shared-catalog domain object. Direct authenticated clients cannot assign Product IDs or access the private import staging table.

## RPC contract

Preview calls `preview_supplier_catalog_import(p_organization_id, p_idempotency_key, p_rows)`. Each submitted row has this shape; mapped CSV cell values remain strings so the server can validate their exact representation:

```json
{
  "row_number": 2,
  "values": {
    "sku": "SUP-001",
    "title": "Flour",
    "category": "Dry goods",
    "sell_unit_label": "bag",
    "units_per_sell_unit": "1",
    "pack_amount": "5",
    "pack_base_unit": "kg",
    "price_amount": "12.50",
    "currency": "EUR",
    "moq": "1",
    "order_step": "1",
    "availability": "in_stock"
  },
  "client_errors": []
}
```

The preview response includes `import_id`, job `status`, a summary (`added`, `updated`, `unchanged`, `errors`), and per-row `status`, `errors`, `changes`, and `expected_version`. Apply calls `apply_supplier_catalog_import(p_organization_id, p_import_id)` and returns an applied status and the staged summary. Client-side UUID checks improve feedback but do not replace the server's tenant-scoped ownership checks.

## Verification

Run `npm run verify`, `npm run format`, and `npm run e2e` for local lint, types, unit/component tests, build, formatting, and browser tests. Database migration and pgTAP coverage run in the repository's GitHub Actions job against an ephemeral local Supabase/Postgres database; these checks do not use a live database. Local synthetic tests demonstrate implementation behavior only, not production readiness or external service behavior.
