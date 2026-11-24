-- The generated TypeScript contract exposes created_at; return it from both
-- private worker and public invoker wrapper. OUT-column changes require recreate.

drop function public.list_buyer_supplier_suborder_workflows(uuid, uuid);
drop function private.list_buyer_supplier_suborder_workflows(uuid, uuid);

create function private.list_buyer_supplier_suborder_workflows(
  p_buyer_organization_id uuid,
  p_buyer_request_id uuid
)
returns table (
  supplier_suborder_id uuid,
  status text,
  workflow_version integer,
  current_terms_version integer,
  terms_reason text,
  response_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  lines jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or p_buyer_organization_id is null
     or p_buyer_request_id is null
     or not private.has_org_role(
       p_buyer_organization_id, array['owner', 'admin', 'buyer', 'viewer']::text[]
     )
     or not exists (
       select 1 from public.organizations as organization
       where organization.id = p_buyer_organization_id
         and organization.organization_type = 'buyer'
     ) then
    raise exception using errcode = '42501', message = 'buyer membership required';
  end if;

  if not exists (
    select 1 from public.buyer_procurement_requests as request
    where request.organization_id = p_buyer_organization_id
      and request.id = p_buyer_request_id
  ) then
    raise exception using errcode = 'P0002', message = 'buyer request not found';
  end if;

  return query
  select workflow.supplier_suborder_id, workflow.status,
         workflow.workflow_version, workflow.current_terms_version,
         terms.reason, terms.response_deadline_at,
         workflow.created_at, workflow.updated_at,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'buyer_request_line_id', term_line.buyer_request_line_id,
               'title', request_line.title,
               'sell_unit_label', request_line.sell_unit_label,
               'units_per_sell_unit', request_line.units_per_sell_unit,
               'pack_amount', request_line.pack_amount::text,
               'pack_base_unit', request_line.pack_base_unit,
               'quantity', term_line.quantity,
               'price_amount', term_line.price_amount::text,
               'currency', term_line.currency
             ) order by term_line.buyer_request_line_id
           ) filter (where term_line.buyer_request_line_id is not null),
           '[]'::jsonb
         )
    from private.platform_supplier_suborder_workflows as workflow
    join private.platform_supplier_suborder_terms as terms
      on terms.supplier_suborder_id = workflow.supplier_suborder_id
     and terms.terms_version = workflow.current_terms_version
    left join private.platform_supplier_suborder_term_lines as term_line
      on term_line.supplier_suborder_id = terms.supplier_suborder_id
     and term_line.terms_version = terms.terms_version
    left join public.buyer_procurement_request_lines as request_line
      on request_line.organization_id = workflow.organization_id
     and request_line.request_id = workflow.buyer_request_id
     and request_line.id = term_line.buyer_request_line_id
   where workflow.organization_id = p_buyer_organization_id
     and workflow.buyer_request_id = p_buyer_request_id
   group by workflow.supplier_suborder_id, workflow.status, workflow.workflow_version,
            workflow.current_terms_version, terms.reason, terms.response_deadline_at,
            workflow.created_at, workflow.updated_at
   order by workflow.supplier_suborder_id;
end;
$$;
revoke all on function private.list_buyer_supplier_suborder_workflows(uuid, uuid) from public, anon;
grant execute on function private.list_buyer_supplier_suborder_workflows(uuid, uuid) to authenticated;

create function public.list_buyer_supplier_suborder_workflows(
  p_buyer_organization_id uuid,
  p_buyer_request_id uuid
)
returns table (
  supplier_suborder_id uuid,
  status text,
  workflow_version integer,
  current_terms_version integer,
  terms_reason text,
  response_deadline_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  lines jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.list_buyer_supplier_suborder_workflows(
    p_buyer_organization_id, p_buyer_request_id
  );
$$;
revoke all on function public.list_buyer_supplier_suborder_workflows(uuid, uuid) from public, anon;
grant execute on function public.list_buyer_supplier_suborder_workflows(uuid, uuid) to authenticated;

comment on function public.list_buyer_supplier_suborder_workflows(uuid, uuid) is
  'SECURITY INVOKER RPC; returns current workflow versions, including their created_at timestamps, only for the caller''s buyer tenant and requested parent.';
