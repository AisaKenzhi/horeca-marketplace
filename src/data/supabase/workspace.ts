import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BuyerLocationRow,
  CatalogAvailability,
  CatalogOfferRow,
  Database,
  MembershipRole,
  OrganizationRow,
  OrganizationType,
  SupplierProfileRow,
} from "./database.types";
import {
  validateBuyerLocation,
  validateCatalogOffer,
  validateCatalogOfferTerms,
  validateOrganizationName,
} from "./validation";

export type WorkspaceClient = SupabaseClient<Database>;

export interface BuyerLocationDraft {
  readonly name: string;
  readonly address: string;
  readonly deliveryZone: string;
}

export interface CatalogOfferDraft {
  readonly supplierSku: string;
  readonly title: string;
  readonly category: string;
  readonly sellUnitLabel: string;
  readonly unitsPerSellUnit: number;
  readonly packAmount: number;
  readonly packBaseUnit: "kg" | "l" | "piece";
  readonly priceAmount: number | null;
  readonly currency: string | null;
  readonly moq: number;
  readonly orderStep: number;
  readonly availability:
    "in_stock" | "low_stock" | "out_of_stock" | "on_request" | "unknown";
}

export interface CatalogOfferTerms {
  readonly priceAmount: number | null;
  readonly currency: string | null;
  readonly availability: CatalogAvailability;
}

export interface OrganizationWorkspace extends OrganizationRow {
  readonly role: MembershipRole;
}

export interface WorkspaceSnapshot {
  readonly organizations: readonly OrganizationWorkspace[];
  readonly locations: readonly BuyerLocationRow[];
  readonly supplierProfiles: readonly SupplierProfileRow[];
  /** Rows visible under RLS; includes the supplier's own drafts. */
  readonly offers: readonly CatalogOfferRow[];
  /** Published offers from approved suppliers only. */
  readonly catalog: readonly CatalogOfferRow[];
}

export type WorkspaceErrorCode =
  | "invalid"
  | "permission"
  | "duplicate"
  | "unavailable"
  | "not_found"
  | "operation_failed";

export function canManageSupplierCatalog(role: MembershipRole): boolean {
  return role === "owner" || role === "admin" || role === "catalog_operator";
}

export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode) {
    super(code);
    this.name = "WorkspaceError";
  }
}

const OFFER_COLUMNS =
  "id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_amount,currency,moq,order_step,availability,price_valid_until,is_published,price_observed_at,availability_observed_at,version,created_at,updated_at" as const;

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const value: unknown = error.code;
  return typeof value === "string" ? value : null;
}

function mapError(error: unknown): WorkspaceError {
  const code = errorCode(error);
  if (code === "23505") return new WorkspaceError("duplicate");
  if (code === "42501") return new WorkspaceError("permission");
  if (code === "PGRST116") return new WorkspaceError("not_found");
  if (code === "22P02" || code === "23514" || code === "23503") {
    return new WorkspaceError("invalid");
  }
  return new WorkspaceError("unavailable");
}

function unwrap<T>(data: T | null, error: unknown): T {
  if (error) throw mapError(error);
  if (data === null) throw new WorkspaceError("unavailable");
  return data;
}

async function assertSupplierCatalogEditAccess(
  client: WorkspaceClient,
  organizationId: string,
): Promise<void> {
  const membershipResult = await client
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (membershipResult.error) throw mapError(membershipResult.error);
  if (!membershipResult.data || !canManageSupplierCatalog(membershipResult.data.role)) {
    throw new WorkspaceError("permission");
  }

  const [organizationResult, profileResult] = await Promise.all([
    client
      .from("organizations")
      .select("organization_type")
      .eq("id", organizationId)
      .maybeSingle(),
    client
      .from("supplier_profiles")
      .select("verification_status")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (organizationResult.error) throw mapError(organizationResult.error);
  if (profileResult.error) throw mapError(profileResult.error);
  if (
    organizationResult.data?.organization_type !== "supplier" ||
    profileResult.data?.verification_status !== "approved"
  ) {
    throw new WorkspaceError("permission");
  }
}

export function workspaceErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceError) {
    switch (error.code) {
      case "invalid":
        return "Проверьте введённые данные и повторите попытку.";
      case "permission":
        return "У этой учётной записи нет прав на это действие.";
      case "duplicate":
        return "Такая организация, точка или SKU уже существует.";
      case "not_found":
        return "Запись больше недоступна. Обновите страницу и попробуйте ещё раз.";
      case "unavailable":
        return "Не удалось связаться с рабочим контуром. Проверьте подключение и повторите попытку.";
      case "operation_failed":
        return "Действие не выполнено. Обновите данные и проверьте права или состояние записи.";
    }
  }

  const code = errorCode(error);
  if (code === "invalid_credentials") {
    return "Не удалось войти: проверьте email и пароль.";
  }
  if (code === "email_not_confirmed") {
    return "Сначала подтвердите email по ссылке из письма.";
  }
  if (code === "weak_password") {
    return "Пароль не соответствует требованиям Supabase Auth.";
  }
  if (code === "user_already_exists") {
    return "Этот email уже зарегистрирован. Попробуйте войти.";
  }
  return "Не удалось выполнить запрос. Проверьте данные и попробуйте позже.";
}

export async function loadWorkspace(client: WorkspaceClient): Promise<WorkspaceSnapshot> {
  const [
    organizationsResult,
    membershipsResult,
    locationsResult,
    profilesResult,
    offersResult,
  ] = await Promise.all([
    client
      .from("organizations")
      .select("id,name,organization_type,created_by,created_at")
      .order("created_at", { ascending: true }),
    client.from("organization_memberships").select("organization_id,role"),
    client
      .from("buyer_locations")
      .select("id,organization_id,name,address,delivery_zone,created_at")
      .order("created_at", { ascending: true }),
    client
      .from("supplier_profiles")
      .select("organization_id,display_name,verification_status,created_at")
      .order("created_at", { ascending: true }),
    client
      .from("catalog_offers")
      .select(OFFER_COLUMNS)
      .order("title", { ascending: true }),
  ]);

  const organizationRows = unwrap(organizationsResult.data, organizationsResult.error);
  const membershipRows = unwrap(membershipsResult.data, membershipsResult.error);
  const locations = unwrap(locationsResult.data, locationsResult.error);
  const supplierProfiles = unwrap(profilesResult.data, profilesResult.error);
  const offers = unwrap(offersResult.data, offersResult.error);

  const rolesByOrganization = new Map(
    membershipRows.map((membership) => [membership.organization_id, membership.role]),
  );
  const organizations: OrganizationWorkspace[] = organizationRows.flatMap(
    (organization) => {
      const role = rolesByOrganization.get(organization.id);
      return role ? [{ ...organization, role }] : [];
    },
  );
  const approvedSupplierIds = new Set(
    supplierProfiles
      .filter((profile) => profile.verification_status === "approved")
      .map((profile) => profile.organization_id),
  );
  const catalog = offers.filter(
    (offer) =>
      offer.is_published && approvedSupplierIds.has(offer.supplier_organization_id),
  );

  return { organizations, locations, supplierProfiles, offers, catalog };
}

export async function createOrganization(
  client: WorkspaceClient,
  input: {
    readonly name: string;
    readonly type: OrganizationType;
    readonly userId: string;
  },
): Promise<OrganizationRow> {
  if (validateOrganizationName(input.name)) throw new WorkspaceError("invalid");
  const { data, error } = await client
    .from("organizations")
    .insert({
      name: input.name.trim(),
      organization_type: input.type,
      created_by: input.userId,
    })
    .select("id,name,organization_type,created_by,created_at")
    .single();
  return unwrap(data, error);
}

export async function createBuyerLocation(
  client: WorkspaceClient,
  organizationId: string,
  input: BuyerLocationDraft,
): Promise<BuyerLocationRow> {
  if (validateBuyerLocation(input)) throw new WorkspaceError("invalid");
  const { data, error } = await client
    .from("buyer_locations")
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      address: input.address.trim(),
      delivery_zone: input.deliveryZone.trim() || null,
    })
    .select("id,organization_id,name,address,delivery_zone,created_at")
    .single();
  return unwrap(data, error);
}

export async function createSupplierProfile(
  client: WorkspaceClient,
  organizationId: string,
  displayName: string,
): Promise<SupplierProfileRow> {
  const normalized = displayName.trim();
  if (normalized.length < 2 || normalized.length > 160) {
    throw new WorkspaceError("invalid");
  }
  const { data, error } = await client
    .from("supplier_profiles")
    .insert({ organization_id: organizationId, display_name: normalized })
    .select("organization_id,display_name,verification_status,created_at")
    .single();
  return unwrap(data, error);
}

export async function createCatalogOffer(
  client: WorkspaceClient,
  organizationId: string,
  input: CatalogOfferDraft,
): Promise<CatalogOfferRow> {
  if (validateCatalogOffer(input)) throw new WorkspaceError("invalid");
  const { data, error } = await client
    .from("catalog_offers")
    .insert({
      supplier_organization_id: organizationId,
      supplier_sku: input.supplierSku.trim(),
      title: input.title.trim(),
      category: input.category.trim(),
      sell_unit_label: input.sellUnitLabel.trim(),
      units_per_sell_unit: input.unitsPerSellUnit,
      pack_amount: input.packAmount,
      pack_base_unit: input.packBaseUnit,
      price_amount: input.priceAmount,
      currency: input.currency,
      moq: input.moq,
      order_step: input.orderStep,
      availability: input.availability,
      is_published: false,
    })
    .select(OFFER_COLUMNS)
    .single();
  return unwrap(data, error);
}

export async function setCatalogOfferPublished(
  client: WorkspaceClient,
  offerId: string,
  isPublished: boolean,
): Promise<CatalogOfferRow> {
  const { data, error } = await client
    .from("catalog_offers")
    .update({ is_published: isPublished })
    .eq("id", offerId)
    .select(OFFER_COLUMNS)
    .single();
  return unwrap(data, error);
}

export async function updateCatalogOfferTerms(
  client: WorkspaceClient,
  organizationId: string,
  offerId: string,
  input: CatalogOfferTerms,
): Promise<CatalogOfferRow> {
  if (validateCatalogOfferTerms(input)) throw new WorkspaceError("invalid");
  await assertSupplierCatalogEditAccess(client, organizationId);

  const { data, error } = await client
    .from("catalog_offers")
    .update({
      price_amount: input.priceAmount,
      currency: input.currency,
      availability: input.availability,
    })
    .eq("id", offerId)
    .eq("supplier_organization_id", organizationId)
    .select(OFFER_COLUMNS)
    .single();
  return unwrap(data, error);
}

export interface OrganizationMember {
  readonly user_id: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly created_at: string;
}
export interface OrganizationInvitation {
  readonly invitation_id: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly invited_by: string;
  readonly created_at: string;
  readonly expires_at: string;
}

export function canManageOrganization(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function invitationLink(token: string): string {
  const url = new URL("/account", window.location.origin);
  url.hash = `invite=${token}`;
  return url.toString();
}

export async function listOrganizationMembers(
  client: WorkspaceClient,
  organizationId: string,
) {
  const { data, error } = await client.rpc("list_organization_members", {
    p_organization_id: organizationId,
  });
  return unwrap(data, error);
}
export async function listOrganizationInvitations(
  client: WorkspaceClient,
  organizationId: string,
) {
  const { data, error } = await client.rpc("list_organization_invitations", {
    p_organization_id: organizationId,
  });
  return unwrap(data, error);
}
export async function createOrganizationInvitation(
  client: WorkspaceClient,
  organizationId: string,
  email: string,
  role: MembershipRole,
  token: string,
) {
  const { data, error } = await client.rpc("create_organization_invitation", {
    p_organization_id: organizationId,
    p_email: email.trim(),
    p_role: role,
    p_token: token,
  });
  const rows = unwrap(data, error);
  if (rows.length !== 1) throw new WorkspaceError("operation_failed");
  return rows[0];
}

function unwrapSuccessfulMutation(data: boolean | null, error: unknown): void {
  const succeeded = unwrap(data, error);
  if (!succeeded) throw new WorkspaceError("operation_failed");
}

export async function revokeOrganizationInvitation(
  client: WorkspaceClient,
  organizationId: string,
  invitationId: string,
) {
  const { data, error } = await client.rpc("revoke_organization_invitation", {
    p_organization_id: organizationId,
    p_invitation_id: invitationId,
  });
  unwrapSuccessfulMutation(data, error);
}
export async function changeOrganizationMemberRole(
  client: WorkspaceClient,
  organizationId: string,
  userId: string,
  role: MembershipRole,
) {
  const { data, error } = await client.rpc("change_organization_member_role", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_role: role,
  });
  unwrapSuccessfulMutation(data, error);
}
export async function removeOrganizationMember(
  client: WorkspaceClient,
  organizationId: string,
  userId: string,
) {
  const { data, error } = await client.rpc("remove_organization_member", {
    p_organization_id: organizationId,
    p_user_id: userId,
  });
  unwrapSuccessfulMutation(data, error);
}
export async function acceptOrganizationInvitation(
  client: WorkspaceClient,
  token: string,
) {
  const { data, error } = await client.rpc("accept_organization_invitation", {
    p_token: token,
  });
  return unwrap(data, error);
}
