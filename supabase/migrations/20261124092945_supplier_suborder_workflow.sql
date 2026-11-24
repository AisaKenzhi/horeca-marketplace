-- Versioned supplier-suborder response workflow. This records internal decisions
-- only: it never places a supplier order, reserves stock, notifies anyone, charges,
-- invoices, or arranges delivery. Buyer request snapshots and the atomic request
-- RPC remain unchanged.

create table private.platform_supplier_suborder_workflows (
  supplier_suborder_id uuid primary key,
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_organization_id uuid not null,
  status text not null default 'awaiting_supplier'
    check (status in (
      'awaiting_supplier', 'supplier_accepted', 'supplier_rejected',
      'awaiting_buyer_decision', 'buyer_accepted', 'buyer_rejected'
    )),
  workflow_version integer not null default 1 check (workflow_version > 0),
  current_terms_version integer not null default 1 check (current_terms_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id),
  foreign key (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id)
    references private.platform_supplier_suborders
      (organization_id, buyer_request_id, id, supplier_organization_id) on delete restrict,
  check (workflow_version >= current_terms_version)
);

create table private.platform_supplier_suborder_terms (
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_suborder_id uuid not null,
  supplier_organization_id uuid not null,
  terms_version integer not null check (terms_version > 0),
  created_by_organization_id uuid not null references public.organizations (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete restrict,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  response_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (supplier_suborder_id, terms_version),
  foreign key (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id)
    references private.platform_supplier_suborders
      (organization_id, buyer_request_id, id, supplier_organization_id) on delete restrict,
  check (
    (terms_version = 1 and reason is null and response_deadline_at is null)
    or (terms_version > 1 and reason is not null and response_deadline_at is not null)
  )
);

create table private.platform_supplier_suborder_term_lines (
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_organization_id uuid not null,
  supplier_suborder_id uuid not null,
  terms_version integer not null,
  buyer_request_line_id uuid not null,
  quantity integer not null check (quantity between 1 and 1000000),
  price_amount numeric(16, 4) not null check (price_amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  primary key (supplier_suborder_id, terms_version, buyer_request_line_id),
  foreign key (supplier_suborder_id, terms_version)
    references private.platform_supplier_suborder_terms (supplier_suborder_id, terms_version)
    on delete restrict,
  foreign key (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id)
    references private.platform_supplier_suborders
      (organization_id, buyer_request_id, id, supplier_organization_id) on delete restrict,
  -- Term lines are derived from the original suborder lines. Cascade only
  -- cleans up derived rows when a base line is removed; base snapshots,
  -- parent request lines and workflow events are never deleted by this path.
  foreign key (supplier_suborder_id, buyer_request_line_id)
    references private.platform_supplier_suborder_lines (supplier_suborder_id, buyer_request_line_id)
    on delete cascade
);

create table private.platform_supplier_suborder_workflow_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  buyer_request_id uuid not null,
  supplier_organization_id uuid not null,
  supplier_suborder_id uuid not null,
  actor_organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  event_type text not null check (event_type in (
    'request_routed', 'supplier_accepted', 'supplier_rejected',
    'supplier_version_proposed', 'buyer_version_accepted', 'buyer_version_rejected'
  )),
  workflow_version integer not null check (workflow_version > 0),
  terms_version integer not null check (terms_version > 0),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  response_deadline_at timestamptz,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id)
    references private.platform_supplier_suborders
      (organization_id, buyer_request_id, id, supplier_organization_id) on delete restrict,
  foreign key (supplier_suborder_id, terms_version)
    references private.platform_supplier_suborder_terms (supplier_suborder_id, terms_version)
    on delete restrict
);

create table private.platform_supplier_suborder_action_idempotency (
  actor_organization_id uuid not null references public.organizations (id) on delete restrict,
  idempotency_key uuid not null,
  supplier_suborder_id uuid not null
    references private.platform_supplier_suborders (id) on delete restrict,
  operation text not null check (operation in (
    'supplier_accept', 'supplier_reject', 'supplier_propose_version',
    'buyer_accept_version', 'buyer_reject_version'
  )),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (actor_organization_id, idempotency_key)
);

create index platform_supplier_suborder_workflows_supplier_idx
  on private.platform_supplier_suborder_workflows (supplier_organization_id, created_at desc);
create index platform_supplier_suborder_workflows_buyer_request_idx
  on private.platform_supplier_suborder_workflows (organization_id, buyer_request_id, created_at desc);
create index platform_supplier_suborder_terms_line_fk_idx
  on private.platform_supplier_suborder_term_lines (supplier_suborder_id, terms_version);
create index platform_supplier_suborder_term_lines_request_line_fk_idx
  on private.platform_supplier_suborder_term_lines (organization_id, buyer_request_id, buyer_request_line_id);
create index platform_supplier_suborder_events_history_idx
  on private.platform_supplier_suborder_workflow_events (supplier_suborder_id, created_at, event_id);
create index platform_supplier_suborder_events_actor_idx
  on private.platform_supplier_suborder_workflow_events (actor_organization_id, created_at desc);

alter table private.platform_supplier_suborder_workflows enable row level security;
alter table private.platform_supplier_suborder_terms enable row level security;
alter table private.platform_supplier_suborder_term_lines enable row level security;
alter table private.platform_supplier_suborder_workflow_events enable row level security;
alter table private.platform_supplier_suborder_action_idempotency enable row level security;

revoke all on table private.platform_supplier_suborder_workflows from public, anon, authenticated;
revoke all on table private.platform_supplier_suborder_terms from public, anon, authenticated;
revoke all on table private.platform_supplier_suborder_term_lines from public, anon, authenticated;
revoke all on table private.platform_supplier_suborder_workflow_events from public, anon, authenticated;
revoke all on table private.platform_supplier_suborder_action_idempotency from public, anon, authenticated;

create or replace function private.reject_supplier_workflow_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'supplier suborder workflow history is append-only';
end;
$$;
revoke all on function private.reject_supplier_workflow_history_mutation() from public, anon, authenticated;

create trigger platform_supplier_suborder_terms_immutable
  before update or delete on private.platform_supplier_suborder_terms
  for each row execute function private.reject_supplier_workflow_history_mutation();
create trigger platform_supplier_suborder_term_lines_immutable
  before update or delete on private.platform_supplier_suborder_term_lines
  for each row execute function private.reject_supplier_workflow_history_mutation();
create trigger platform_supplier_suborder_workflow_events_immutable
  before update or delete on private.platform_supplier_suborder_workflow_events
  for each row execute function private.reject_supplier_workflow_history_mutation();
create trigger platform_supplier_suborder_action_idempotency_immutable
  before update or delete on private.platform_supplier_suborder_action_idempotency
  for each row execute function private.reject_supplier_workflow_history_mutation();

create or replace function private.guard_supplier_suborder_workflow_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'supplier suborder workflow cannot be deleted';
  end if;
  if current_setting('app.supplier_suborder_workflow_id', true)
       is distinct from old.supplier_suborder_id::text
     or new.supplier_suborder_id is distinct from old.supplier_suborder_id
     or new.organization_id is distinct from old.organization_id
     or new.buyer_request_id is distinct from old.buyer_request_id
     or new.supplier_organization_id is distinct from old.supplier_organization_id
     or new.workflow_version is distinct from old.workflow_version + 1
     or new.current_terms_version not in (old.current_terms_version, old.current_terms_version + 1) then
    raise exception using errcode = '42501', message = 'supplier suborder workflow update is worker-only';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_supplier_suborder_workflow_update() from public, anon, authenticated;
create trigger platform_supplier_suborder_workflows_guard_update
  before update or delete on private.platform_supplier_suborder_workflows
  for each row execute function private.guard_supplier_suborder_workflow_update();

create or replace function private.initialize_supplier_suborder_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.buyer_procurement_requests%rowtype;
  v_inserted integer;
  v_line_inserted integer;
begin
  select request.* into v_request
    from public.buyer_procurement_requests as request
   where request.organization_id = new.organization_id
     and request.id = new.buyer_request_id;
  if not found then
    raise exception using errcode = '23503', message = 'supplier suborder request is missing';
  end if;

  insert into private.platform_supplier_suborder_workflows (
    supplier_suborder_id, organization_id, buyer_request_id, supplier_organization_id
  ) values (
    new.supplier_suborder_id, new.organization_id, new.buyer_request_id, new.supplier_organization_id
  ) on conflict (supplier_suborder_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into private.platform_supplier_suborder_terms (
      organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id,
      terms_version, created_by_organization_id, created_by
    ) values (
      new.organization_id, new.buyer_request_id, new.supplier_suborder_id,
      new.supplier_organization_id, 1, new.organization_id, v_request.submitted_by
    );
    insert into private.platform_supplier_suborder_workflow_events (
      organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
      actor_organization_id, actor_user_id, event_type, workflow_version, terms_version
    ) values (
      new.organization_id, new.buyer_request_id, new.supplier_organization_id,
      new.supplier_suborder_id, new.organization_id, v_request.submitted_by,
      'request_routed', 1, 1
    );
  end if;

  insert into private.platform_supplier_suborder_term_lines (
    organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
    terms_version, buyer_request_line_id, quantity, price_amount, currency
  )
  select
    new.organization_id, new.buyer_request_id, new.supplier_organization_id,
    new.supplier_suborder_id, 1, request_line.id, request_line.quantity,
    request_line.price_amount, request_line.currency
  from public.buyer_procurement_request_lines as request_line
  where request_line.organization_id = new.organization_id
    and request_line.request_id = new.buyer_request_id
    and request_line.id = new.buyer_request_line_id
    and request_line.quantity = new.quantity;
  get diagnostics v_line_inserted = row_count;
  if v_line_inserted <> 1 then
    raise exception using errcode = '23503', message = 'supplier suborder snapshot line is missing';
  end if;

  return new;
end;
$$;
revoke all on function private.initialize_supplier_suborder_workflow() from public, anon, authenticated;
create trigger platform_supplier_suborder_lines_initialize_workflow
  after insert on private.platform_supplier_suborder_lines
  for each row execute function private.initialize_supplier_suborder_workflow();

-- Backfill suborders persisted by the earlier request migration. New suborders
-- are initialized by the line trigger above, inside the existing atomic request.
insert into private.platform_supplier_suborder_workflows (
  supplier_suborder_id, organization_id, buyer_request_id, supplier_organization_id
)
select distinct suborder.id, suborder.organization_id, suborder.buyer_request_id,
       suborder.supplier_organization_id
from private.platform_supplier_suborders as suborder
join private.platform_supplier_suborder_lines as subline
  on subline.supplier_suborder_id = suborder.id
 and subline.organization_id = suborder.organization_id
 and subline.buyer_request_id = suborder.buyer_request_id
 and subline.supplier_organization_id = suborder.supplier_organization_id
on conflict (supplier_suborder_id) do nothing;

insert into private.platform_supplier_suborder_terms (
  organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id,
  terms_version, created_by_organization_id, created_by
)
select workflow.organization_id, workflow.buyer_request_id, workflow.supplier_suborder_id,
       workflow.supplier_organization_id, 1, workflow.organization_id, request.submitted_by
from private.platform_supplier_suborder_workflows as workflow
join public.buyer_procurement_requests as request
  on request.organization_id = workflow.organization_id
 and request.id = workflow.buyer_request_id
where not exists (
  select 1 from private.platform_supplier_suborder_terms as terms
  where terms.supplier_suborder_id = workflow.supplier_suborder_id and terms.terms_version = 1
);

insert into private.platform_supplier_suborder_term_lines (
  organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
  terms_version, buyer_request_line_id, quantity, price_amount, currency
)
select subline.organization_id, subline.buyer_request_id, subline.supplier_organization_id,
       subline.supplier_suborder_id, 1, request_line.id, request_line.quantity,
       request_line.price_amount, request_line.currency
from private.platform_supplier_suborder_lines as subline
join public.buyer_procurement_request_lines as request_line
  on request_line.organization_id = subline.organization_id
 and request_line.request_id = subline.buyer_request_id
 and request_line.id = subline.buyer_request_line_id
 and request_line.quantity = subline.quantity
where not exists (
  select 1
  from private.platform_supplier_suborder_term_lines as term_line
  where term_line.supplier_suborder_id = subline.supplier_suborder_id
    and term_line.terms_version = 1
    and term_line.buyer_request_line_id = subline.buyer_request_line_id
);

insert into private.platform_supplier_suborder_workflow_events (
  organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
  actor_organization_id, actor_user_id, event_type, workflow_version, terms_version
)
select workflow.organization_id, workflow.buyer_request_id, workflow.supplier_organization_id,
       workflow.supplier_suborder_id, workflow.organization_id, request.submitted_by,
       'request_routed', 1, 1
from private.platform_supplier_suborder_workflows as workflow
join public.buyer_procurement_requests as request
  on request.organization_id = workflow.organization_id
 and request.id = workflow.buyer_request_id
where not exists (
  select 1 from private.platform_supplier_suborder_workflow_events as event
  where event.supplier_suborder_id = workflow.supplier_suborder_id
    and event.event_type = 'request_routed'
);

create or replace function private.list_supplier_suborders(p_supplier_organization_id uuid)
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
     or p_supplier_organization_id is null
     or not private.has_org_role(
       p_supplier_organization_id, array['owner', 'admin', 'order_operator']::text[]
     )
     or not exists (
       select 1 from public.organizations as organization
       where organization.id = p_supplier_organization_id
         and organization.organization_type = 'supplier'
     ) then
    raise exception using errcode = '42501', message = 'supplier order membership required';
  end if;

  return query
  select workflow.supplier_suborder_id, workflow.status,
         workflow.workflow_version, workflow.current_terms_version,
         terms.reason, terms.response_deadline_at, workflow.created_at, workflow.updated_at,
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
   where workflow.supplier_organization_id = p_supplier_organization_id
   group by workflow.supplier_suborder_id, workflow.status, workflow.workflow_version,
            workflow.current_terms_version, terms.reason, terms.response_deadline_at,
            workflow.created_at, workflow.updated_at
   order by workflow.created_at desc, workflow.supplier_suborder_id;
end;
$$;
revoke all on function private.list_supplier_suborders(uuid) from public, anon;
grant execute on function private.list_supplier_suborders(uuid) to authenticated;

create or replace function public.list_supplier_suborders(p_supplier_organization_id uuid)
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
  select * from private.list_supplier_suborders(p_supplier_organization_id);
$$;
revoke all on function public.list_supplier_suborders(uuid) from public, anon;
grant execute on function public.list_supplier_suborders(uuid) to authenticated;

create or replace function private.list_buyer_supplier_suborder_workflows(
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
         terms.reason, terms.response_deadline_at, workflow.updated_at,
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
            workflow.updated_at
   order by workflow.supplier_suborder_id;
end;
$$;
revoke all on function private.list_buyer_supplier_suborder_workflows(uuid, uuid) from public, anon;
grant execute on function private.list_buyer_supplier_suborder_workflows(uuid, uuid) to authenticated;

create or replace function public.list_buyer_supplier_suborder_workflows(
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

create or replace function private.apply_supplier_suborder_action(
  p_actor_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_action text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_reason text default null,
  p_response_deadline_at timestamptz default null,
  p_terms_version integer default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_supplier_action boolean;
  v_workflow private.platform_supplier_suborder_workflows%rowtype;
  v_existing private.platform_supplier_suborder_action_idempotency%rowtype;
  v_input_line jsonb;
  v_line_id uuid;
  v_quantity integer;
  v_price_amount numeric(16, 4);
  v_old_quantity integer;
  v_old_price_amount numeric(16, 4);
  v_line_count integer;
  v_input_count integer;
  v_distinct_line_count integer;
  v_changed_line_count integer := 0;
  v_key_count integer;
  v_new_terms_version integer;
  v_new_workflow_version integer;
  v_next_status text;
  v_event_type text;
  v_event_id uuid := gen_random_uuid();
  v_payload_fingerprint text;
  v_result jsonb;
  v_inserted integer;
begin
  if (select auth.uid()) is null
     or p_actor_organization_id is null
     or p_supplier_suborder_id is null
     or p_action is null
     or p_expected_version is null or p_expected_version < 1
     or p_idempotency_key is null then
    raise exception using errcode = '23514', message = 'workflow action input is invalid';
  end if;

  v_is_supplier_action := p_action in ('supplier_accept', 'supplier_reject', 'supplier_propose_version');
  if not v_is_supplier_action
     and p_action not in ('buyer_accept_version', 'buyer_reject_version') then
    raise exception using errcode = '23514', message = 'workflow action is invalid';
  end if;

  if v_is_supplier_action then
    if not private.has_org_role(
         p_actor_organization_id, array['owner', 'admin', 'order_operator']::text[]
       )
       or not exists (
         select 1 from public.organizations as organization
         where organization.id = p_actor_organization_id
           and organization.organization_type = 'supplier'
       ) then
      raise exception using errcode = '42501', message = 'supplier order membership required';
    end if;
  else
    if not private.has_org_role(
         p_actor_organization_id, array['owner', 'admin', 'buyer']::text[]
       )
       or not exists (
         select 1 from public.organizations as organization
         where organization.id = p_actor_organization_id
           and organization.organization_type = 'buyer'
       ) then
      raise exception using errcode = '42501', message = 'buyer manager membership required';
    end if;
  end if;

  if p_action in ('supplier_reject', 'supplier_propose_version')
     and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000) then
    raise exception using errcode = '23514', message = 'a short reason is required';
  end if;
  if p_action = 'buyer_reject_version'
     and p_reason is not null and char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '23514', message = 'buyer rejection reason is invalid';
  end if;
  if p_action = 'supplier_propose_version'
     and (p_response_deadline_at is null or p_response_deadline_at <= clock_timestamp()) then
    raise exception using errcode = '23514', message = 'a future response deadline is required';
  end if;
  if p_action in ('buyer_accept_version', 'buyer_reject_version')
     and p_terms_version is null then
    raise exception using errcode = '23514', message = 'a specific proposed terms version is required';
  end if;
  if p_action in ('supplier_accept', 'supplier_reject', 'buyer_accept_version', 'buyer_reject_version')
     and (p_response_deadline_at is not null or p_lines is not null) then
    raise exception using errcode = '23514', message = 'unexpected workflow action fields';
  end if;
  if p_action in ('supplier_accept', 'supplier_propose_version') and p_terms_version is not null then
    raise exception using errcode = '23514', message = 'unexpected terms version';
  end if;
  if p_action in ('supplier_accept', 'buyer_accept_version') and p_reason is not null then
    raise exception using errcode = '23514', message = 'unexpected workflow reason';
  end if;
  if p_action = 'supplier_reject' and p_terms_version is not null then
    raise exception using errcode = '23514', message = 'unexpected terms version';
  end if;
  if p_action in ('buyer_accept_version', 'buyer_reject_version') and p_lines is not null then
    raise exception using errcode = '23514', message = 'unexpected workflow action fields';
  end if;

  if p_action = 'supplier_propose_version' then
    if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
      raise exception using errcode = '23514', message = 'proposed terms lines are invalid';
    end if;
    if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 1000 then
      raise exception using errcode = '23514', message = 'proposed terms lines are invalid';
    end if;
  end if;

  v_payload_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'actor_organization_id', p_actor_organization_id,
        'supplier_suborder_id', p_supplier_suborder_id,
        'action', p_action,
        'expected_version', p_expected_version,
        'reason', nullif(btrim(p_reason), ''),
        'response_deadline_at', p_response_deadline_at,
        'terms_version', p_terms_version,
        'lines', p_lines
      )::text,
      'UTF8'
    )),
    'hex'
  );

  -- Lock the one authorized workflow row before checking idempotency or version.
  -- A foreign ID is indistinguishable from a missing one.
  select workflow.* into v_workflow
    from private.platform_supplier_suborder_workflows as workflow
   where workflow.supplier_suborder_id = p_supplier_suborder_id
     and (
       (v_is_supplier_action and workflow.supplier_organization_id = p_actor_organization_id)
       or (not v_is_supplier_action and workflow.organization_id = p_actor_organization_id)
     )
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'supplier suborder not found';
  end if;

  select idem.* into v_existing
    from private.platform_supplier_suborder_action_idempotency as idem
   where idem.actor_organization_id = p_actor_organization_id
     and idem.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.supplier_suborder_id is distinct from p_supplier_suborder_id
       or v_existing.operation is distinct from p_action
       or v_existing.payload_fingerprint is distinct from v_payload_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency key conflict';
    end if;
    return v_existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  if v_workflow.workflow_version is distinct from p_expected_version then
    raise exception using errcode = '40001', message = 'supplier suborder workflow version changed';
  end if;

  if p_action = 'supplier_propose_version' then
    begin
      select count(*)::integer,
             count(distinct value ->> 'buyer_request_line_id')::integer
        into v_input_count, v_distinct_line_count
        from pg_catalog.jsonb_array_elements(p_lines) as item(value);
    exception when others then
      raise exception using errcode = '23514', message = 'proposed terms lines are invalid';
    end;

    select count(*)::integer into v_line_count
      from private.platform_supplier_suborder_lines as subline
     where subline.supplier_suborder_id = p_supplier_suborder_id;
    if v_line_count = 0 or v_input_count <> v_line_count or v_distinct_line_count <> v_input_count then
      raise exception using errcode = '23514', message = 'proposal must include each suborder line exactly once';
    end if;

    for v_input_line in select value from pg_catalog.jsonb_array_elements(p_lines) as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_input_line) is distinct from 'object' then
        raise exception using errcode = '23514', message = 'proposed terms line is invalid';
      end if;
      select count(*)::integer into v_key_count
        from pg_catalog.jsonb_object_keys(v_input_line) as item(key);
      if v_key_count <> 3
         or not (v_input_line ? 'buyer_request_line_id')
         or not (v_input_line ? 'quantity')
         or not (v_input_line ? 'price_amount')
         or pg_catalog.jsonb_typeof(v_input_line -> 'buyer_request_line_id') is distinct from 'string'
         or pg_catalog.jsonb_typeof(v_input_line -> 'quantity') is distinct from 'number'
         or pg_catalog.jsonb_typeof(v_input_line -> 'price_amount') is distinct from 'string'
         or (v_input_line ->> 'quantity') !~ '^[1-9][0-9]{0,6}$'
         or (v_input_line ->> 'price_amount') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,4})?$' then
        raise exception using errcode = '23514', message = 'proposed terms line is invalid';
      end if;

      begin
        v_line_id := (v_input_line ->> 'buyer_request_line_id')::uuid;
        v_quantity := (v_input_line ->> 'quantity')::integer;
        v_price_amount := (v_input_line ->> 'price_amount')::numeric(16, 4);
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '23514', message = 'proposed terms line is invalid';
      end;
      if v_quantity < 1 or v_quantity > 1000000 or v_price_amount <= 0 then
        raise exception using errcode = '23514', message = 'proposed terms line is outside allowed bounds';
      end if;
      if not exists (
        select 1 from private.platform_supplier_suborder_lines as subline
        where subline.supplier_suborder_id = p_supplier_suborder_id
          and subline.buyer_request_line_id = v_line_id
      ) then
        raise exception using errcode = '23514', message = 'proposal references a line outside this suborder';
      end if;

      select current_line.quantity, current_line.price_amount
        into v_old_quantity, v_old_price_amount
        from private.platform_supplier_suborder_term_lines as current_line
       where current_line.supplier_suborder_id = p_supplier_suborder_id
         and current_line.terms_version = v_workflow.current_terms_version
         and current_line.buyer_request_line_id = v_line_id;
      if not found then
        raise exception using errcode = '55000', message = 'current supplier suborder terms are unavailable';
      end if;
      if v_quantity is distinct from v_old_quantity
         or v_price_amount is distinct from v_old_price_amount then
        v_changed_line_count := v_changed_line_count + 1;
      end if;
    end loop;

    if v_changed_line_count = 0 then
      raise exception using errcode = '23514', message = 'a proposed version must change quantity or price';
    end if;
  end if;

  if p_action = 'supplier_accept' then
    if v_workflow.status <> 'awaiting_supplier' then
      raise exception using errcode = '55000', message = 'supplier response is not allowed in this workflow state';
    end if;
    v_next_status := 'supplier_accepted';
    v_event_type := 'supplier_accepted';
    v_new_terms_version := v_workflow.current_terms_version;
  elsif p_action = 'supplier_reject' then
    if v_workflow.status <> 'awaiting_supplier' then
      raise exception using errcode = '55000', message = 'supplier response is not allowed in this workflow state';
    end if;
    v_next_status := 'supplier_rejected';
    v_event_type := 'supplier_rejected';
    v_new_terms_version := v_workflow.current_terms_version;
  elsif p_action = 'supplier_propose_version' then
    if v_workflow.status <> 'awaiting_supplier' then
      raise exception using errcode = '55000', message = 'supplier response is not allowed in this workflow state';
    end if;
    v_new_terms_version := v_workflow.current_terms_version + 1;
    insert into private.platform_supplier_suborder_terms (
      organization_id, buyer_request_id, supplier_suborder_id, supplier_organization_id,
      terms_version, created_by_organization_id, created_by, reason, response_deadline_at
    ) values (
      v_workflow.organization_id, v_workflow.buyer_request_id, v_workflow.supplier_suborder_id,
      v_workflow.supplier_organization_id, v_new_terms_version,
      p_actor_organization_id, (select auth.uid()), btrim(p_reason), p_response_deadline_at
    );
    insert into private.platform_supplier_suborder_term_lines (
      organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
      terms_version, buyer_request_line_id, quantity, price_amount, currency
    )
    select v_workflow.organization_id, v_workflow.buyer_request_id,
           v_workflow.supplier_organization_id, v_workflow.supplier_suborder_id,
           v_new_terms_version, subline.buyer_request_line_id,
           (input.value ->> 'quantity')::integer,
           (input.value ->> 'price_amount')::numeric(16, 4), current_line.currency
    from pg_catalog.jsonb_array_elements(p_lines) as input(value)
    join private.platform_supplier_suborder_lines as subline
      on subline.supplier_suborder_id = v_workflow.supplier_suborder_id
     and subline.buyer_request_line_id = (input.value ->> 'buyer_request_line_id')::uuid
    join private.platform_supplier_suborder_term_lines as current_line
      on current_line.supplier_suborder_id = subline.supplier_suborder_id
     and current_line.terms_version = v_workflow.current_terms_version
     and current_line.buyer_request_line_id = subline.buyer_request_line_id;
    v_next_status := 'awaiting_buyer_decision';
    v_event_type := 'supplier_version_proposed';
  elsif p_action = 'buyer_accept_version' or p_action = 'buyer_reject_version' then
    if p_terms_version is distinct from v_workflow.current_terms_version then
      raise exception using errcode = '40001', message = 'the specific proposed terms version changed';
    end if;
    if v_workflow.status <> 'awaiting_buyer_decision' then
      raise exception using errcode = '55000', message = 'buyer decision is not allowed in this workflow state';
    end if;
    if p_action = 'buyer_accept_version' then
      v_next_status := 'buyer_accepted';
      v_event_type := 'buyer_version_accepted';
    else
      v_next_status := 'buyer_rejected';
      v_event_type := 'buyer_version_rejected';
    end if;
    v_new_terms_version := v_workflow.current_terms_version;
  else
    raise exception using errcode = '23514', message = 'workflow action is invalid';
  end if;

  v_new_workflow_version := v_workflow.workflow_version + 1;
  perform pg_catalog.set_config('app.supplier_suborder_workflow_id', p_supplier_suborder_id::text, true);
  update private.platform_supplier_suborder_workflows as workflow
     set status = v_next_status,
         workflow_version = v_new_workflow_version,
         current_terms_version = v_new_terms_version,
         updated_at = clock_timestamp()
   where workflow.supplier_suborder_id = p_supplier_suborder_id;
  perform pg_catalog.set_config('app.supplier_suborder_workflow_id', '', true);

  insert into private.platform_supplier_suborder_workflow_events (
    organization_id, buyer_request_id, supplier_organization_id, supplier_suborder_id,
    actor_organization_id, actor_user_id, event_type, workflow_version, terms_version,
    reason, response_deadline_at, idempotency_key, event_id
  ) values (
    v_workflow.organization_id, v_workflow.buyer_request_id, v_workflow.supplier_organization_id,
    v_workflow.supplier_suborder_id, p_actor_organization_id, (select auth.uid()),
    v_event_type, v_new_workflow_version, v_new_terms_version,
    nullif(btrim(p_reason), ''), p_response_deadline_at, p_idempotency_key, v_event_id
  );

  v_result := pg_catalog.jsonb_build_object(
    'supplier_suborder_id', p_supplier_suborder_id,
    'status', v_next_status,
    'workflow_version', v_new_workflow_version,
    'current_terms_version', v_new_terms_version,
    'event_id', v_event_id,
    'replayed', false
  );
  insert into private.platform_supplier_suborder_action_idempotency (
    actor_organization_id, idempotency_key, supplier_suborder_id,
    operation, payload_fingerprint, result
  ) values (
    p_actor_organization_id, p_idempotency_key, p_supplier_suborder_id,
    p_action, v_payload_fingerprint, v_result
  ) on conflict (actor_organization_id, idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception using errcode = 'P0001', message = 'idempotency key conflict';
  end if;

  return v_result;
end;
$$;
revoke all on function private.apply_supplier_suborder_action(uuid, uuid, text, integer, uuid, text, timestamptz, integer, jsonb) from public, anon;
grant execute on function private.apply_supplier_suborder_action(uuid, uuid, text, integer, uuid, text, timestamptz, integer, jsonb) to authenticated;

create or replace function public.accept_supplier_suborder(
  p_supplier_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_suborder_action(
    p_supplier_organization_id, p_supplier_suborder_id, 'supplier_accept',
    p_expected_version, p_idempotency_key
  );
$$;
revoke all on function public.accept_supplier_suborder(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.accept_supplier_suborder(uuid, uuid, integer, uuid) to authenticated;

create or replace function public.reject_supplier_suborder(
  p_supplier_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_suborder_action(
    p_supplier_organization_id, p_supplier_suborder_id, 'supplier_reject',
    p_expected_version, p_idempotency_key, p_reason
  );
$$;
revoke all on function public.reject_supplier_suborder(uuid, uuid, text, integer, uuid) from public, anon;
grant execute on function public.reject_supplier_suborder(uuid, uuid, text, integer, uuid) to authenticated;

create or replace function public.propose_supplier_suborder_version(
  p_supplier_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_reason text,
  p_response_deadline_at timestamptz,
  p_lines jsonb,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_suborder_action(
    p_supplier_organization_id, p_supplier_suborder_id, 'supplier_propose_version',
    p_expected_version, p_idempotency_key, p_reason, p_response_deadline_at, null, p_lines
  );
$$;
revoke all on function public.propose_supplier_suborder_version(uuid, uuid, text, timestamptz, jsonb, integer, uuid) from public, anon;
grant execute on function public.propose_supplier_suborder_version(uuid, uuid, text, timestamptz, jsonb, integer, uuid) to authenticated;

create or replace function public.accept_buyer_supplier_suborder_version(
  p_buyer_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_terms_version integer,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_suborder_action(
    p_buyer_organization_id, p_supplier_suborder_id, 'buyer_accept_version',
    p_expected_version, p_idempotency_key, null, null, p_terms_version
  );
$$;
revoke all on function public.accept_buyer_supplier_suborder_version(uuid, uuid, integer, integer, uuid) from public, anon;
grant execute on function public.accept_buyer_supplier_suborder_version(uuid, uuid, integer, integer, uuid) to authenticated;

create or replace function public.reject_buyer_supplier_suborder_version(
  p_buyer_organization_id uuid,
  p_supplier_suborder_id uuid,
  p_terms_version integer,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_supplier_suborder_action(
    p_buyer_organization_id, p_supplier_suborder_id, 'buyer_reject_version',
    p_expected_version, p_idempotency_key, p_reason, null, p_terms_version
  );
$$;
revoke all on function public.reject_buyer_supplier_suborder_version(uuid, uuid, integer, text, integer, uuid) from public, anon;
grant execute on function public.reject_buyer_supplier_suborder_version(uuid, uuid, integer, text, integer, uuid) to authenticated;

comment on table private.platform_supplier_suborder_workflows is
  'Mutable current state for a private platform supplier suborder; every write is a worker-only versioned transition and never changes buyer request snapshots.';
comment on table private.platform_supplier_suborder_terms is
  'Append-only supplier-suborder terms versions. Version 1 is copied from the buyer request snapshot; later versions require a supplier reason and response deadline.';
comment on table private.platform_supplier_suborder_term_lines is
  'Append-only quantity and price snapshots for each exact supplier-suborder terms version; currency and product/packaging details remain tied to the original buyer snapshot.';
comment on table private.platform_supplier_suborder_workflow_events is
  'Private append-only audit of workflow creation and explicit supplier/buyer decisions; no automated acceptance or execution is implied.';
comment on table private.platform_supplier_suborder_action_idempotency is
  'Private immutable idempotency receipts scoped to the acting tenant; same-key payload changes are rejected.';
comment on function public.list_supplier_suborders(uuid) is
  'SECURITY INVOKER RPC; returns only suborders routed to a supplier tenant where the caller is owner, admin or order_operator. Buyer identity and location are not returned.';
comment on function public.list_buyer_supplier_suborder_workflows(uuid, uuid) is
  'SECURITY INVOKER RPC; returns workflow versions only for the caller''s buyer tenant and requested parent.';
comment on function public.accept_supplier_suborder(uuid, uuid, integer, uuid) is
  'Explicit supplier response to the original terms; this is not a stock reservation or external supplier order.';
comment on function public.reject_supplier_suborder(uuid, uuid, text, integer, uuid) is
  'Explicit supplier rejection of the original terms with an audited reason.';
comment on function public.propose_supplier_suborder_version(uuid, uuid, text, timestamptz, jsonb, integer, uuid) is
  'Creates a complete immutable new terms version with explicit changed quantity and/or price for every line; buyer must decide that exact version.';
comment on function public.accept_buyer_supplier_suborder_version(uuid, uuid, integer, integer, uuid) is
  'Explicit buyer acceptance of the exact current proposed terms version; never means payment, reservation, invoice, or delivery.';
comment on function public.reject_buyer_supplier_suborder_version(uuid, uuid, integer, text, integer, uuid) is
  'Explicit buyer rejection of the exact current proposed terms version with an optional audited reason.';
