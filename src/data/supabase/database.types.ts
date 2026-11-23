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
        Partial<Pick<CatalogOfferRow, "is_published">>
      >;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
