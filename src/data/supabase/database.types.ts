export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type OrganizationType = "buyer" | "supplier";
export type MembershipRole =
  | "owner"
  | "admin"
  | "buyer"
  | "viewer"
  | "receiver"
  | "catalog_operator"
  | "order_operator";
export type VerificationStatus = "pending" | "approved" | "rejected";
export type CatalogAvailability =
  "in_stock" | "low_stock" | "out_of_stock" | "on_request" | "unknown";
export type PackBaseUnit = "kg" | "l" | "piece";

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type OrganizationRow = {
  id: string;
  name: string;
  organization_type: OrganizationType;
  created_by: string;
  created_at: string;
};

export type OrganizationMembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
};

export type BuyerLocationRow = {
  id: string;
  organization_id: string;
  name: string;
  address: string;
  delivery_zone: string | null;
  created_at: string;
};

export type SupplierProfileRow = {
  organization_id: string;
  display_name: string;
  verification_status: VerificationStatus;
  created_at: string;
};

export type CatalogOfferRow = {
  id: string;
  supplier_organization_id: string;
  product_id: string | null;
  supplier_sku: string;
  title: string;
  category: string;
  sell_unit_label: string;
  units_per_sell_unit: number;
  pack_amount: number;
  pack_base_unit: PackBaseUnit;
  price_amount: number | null;
  currency: string | null;
  moq: number;
  order_step: number;
  availability: CatalogAvailability;
  price_valid_until: string | null;
  is_published: boolean;
  price_observed_at: string;
  availability_observed_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type BuyerProcurementListRow = {
  id: string;
  organization_id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type BuyerProcurementListItemRow = {
  id: string;
  organization_id: string;
  list_id: string;
  catalog_offer_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
};

export type BuyerDraftCartRow = {
  id: string;
  organization_id: string;
  buyer_location_id: string | null;
  source_list_name: string;
  created_by: string;
  created_at: string;
};

export type BuyerDraftCartItemRow = {
  id: string;
  organization_id: string;
  cart_id: string;
  catalog_offer_id: string;
  quantity: number;
  catalog_offer_version: number;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<
        OrganizationRow,
        {
          name: string;
          organization_type: OrganizationType;
          created_by: string;
        },
        never
      >;
      organization_memberships: Table<OrganizationMembershipRow, never, never>;
      buyer_locations: Table<
        BuyerLocationRow,
        {
          organization_id: string;
          name: string;
          address: string;
          delivery_zone?: string | null;
        },
        Partial<Pick<BuyerLocationRow, "name" | "address" | "delivery_zone">>
      >;
      supplier_profiles: Table<
        SupplierProfileRow,
        {
          organization_id: string;
          display_name: string;
        },
        Partial<Pick<SupplierProfileRow, "display_name">>
      >;
      catalog_offers: Table<
        CatalogOfferRow,
        {
          supplier_organization_id: string;
          product_id?: never;
          supplier_sku: string;
          title: string;
          category: string;
          sell_unit_label: string;
          units_per_sell_unit: number;
          pack_amount: number | string;
          pack_base_unit: PackBaseUnit;
          price_amount?: number | string | null;
          currency?: string | null;
          moq: number;
          order_step: number;
          availability?: CatalogAvailability;
          price_valid_until?: string | null;
          is_published?: boolean;
        },
        Partial<
          Pick<
            CatalogOfferRow,
            "is_published" | "price_amount" | "currency" | "availability"
          >
        >
      >;
      buyer_procurement_lists: Table<
        BuyerProcurementListRow,
        { organization_id: string; name: string; created_by?: string },
        Partial<Pick<BuyerProcurementListRow, "name">>
      >;
      buyer_procurement_list_items: Table<
        BuyerProcurementListItemRow,
        {
          organization_id: string;
          list_id: string;
          catalog_offer_id: string;
          quantity: number;
        },
        Partial<Pick<BuyerProcurementListItemRow, "quantity">>
      >;
      buyer_draft_carts: Table<
        BuyerDraftCartRow,
        {
          organization_id: string;
          source_list_name: string;
          created_by?: string;
          buyer_location_id?: string | null;
        },
        Partial<Pick<BuyerDraftCartRow, "buyer_location_id">>
      >;
      buyer_draft_cart_items: Table<
        BuyerDraftCartItemRow,
        {
          organization_id: string;
          cart_id: string;
          catalog_offer_id: string;
          quantity: number;
          catalog_offer_version: number;
        },
        Partial<Pick<BuyerDraftCartItemRow, "quantity">>
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      list_organization_members: {
        Args: { p_organization_id: string };
        Returns: {
          user_id: string;
          email: string;
          role: MembershipRole;
          created_at: string;
        }[];
      };
      list_organization_invitations: {
        Args: { p_organization_id: string };
        Returns: {
          invitation_id: string;
          email: string;
          role: MembershipRole;
          invited_by: string;
          created_at: string;
          expires_at: string;
        }[];
      };
      create_organization_invitation: {
        Args: {
          p_organization_id: string;
          p_email: string;
          p_role: MembershipRole;
          p_token: string;
        };
        Returns: { invitation_id: string; expires_at: string }[];
      };
      revoke_organization_invitation: {
        Args: { p_organization_id: string; p_invitation_id: string };
        Returns: boolean;
      };
      change_organization_member_role: {
        Args: { p_organization_id: string; p_user_id: string; p_role: MembershipRole };
        Returns: boolean;
      };
      remove_organization_member: {
        Args: { p_organization_id: string; p_user_id: string };
        Returns: boolean;
      };
      accept_organization_invitation: { Args: { p_token: string }; Returns: string };
      create_buyer_draft_cart: {
        Args: { p_organization_id: string; p_source_list_id: string };
        Returns: string;
      };
      preview_supplier_catalog_import: {
        Args: {
          p_organization_id: string;
          p_idempotency_key: string;
          p_rows: Json;
        };
        Returns: Json;
      };
      apply_supplier_catalog_import: {
        Args: { p_organization_id: string; p_import_id: string };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
