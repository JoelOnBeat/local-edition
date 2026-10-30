import { z } from "zod";

/**
 * What we read from Square's API. Checked against the reference (developer.squareup.com/reference/square, Square-Version
 * 2026-09-16): fields we do not use are omitted, fields that may be absent are optional, so a Square addition never breaks us.
 */

const Money = z.object({ amount: z.number().int().optional(), currency: z.string().optional() });

export const CatalogObject: z.ZodType<CatalogObjectT> = z.lazy(() =>
  z.object({
    type: z.string(),
    id: z.string(),
    version: z.number().optional(),
    is_deleted: z.boolean().optional(),
    present_at_all_locations: z.boolean().optional(),
    present_at_location_ids: z.array(z.string()).optional(),
    item_data: z
      .object({
        name: z.string().optional(),
        description: z.string().nullish(),
        description_plaintext: z.string().nullish(),
        abbreviation: z.string().nullish(),
        product_type: z.string().optional(),
        is_archived: z.boolean().optional(),
        category_id: z.string().optional(),
        categories: z.array(z.object({ id: z.string() })).optional(),
        reporting_category: z.object({ id: z.string() }).optional(),
        variations: z.array(CatalogObject).optional(),
      })
      .optional(),
    item_variation_data: z
      .object({
        item_id: z.string().optional(),
        name: z.string().nullish(),
        sku: z.string().nullish(),
        pricing_type: z.string().optional(),
        price_money: Money.optional(),
        ordinal: z.number().optional(),
      })
      .optional(),
    category_data: z.object({ name: z.string().optional() }).optional(),
  }),
);
export interface CatalogObjectT {
  type: string;
  id: string;
  version?: number;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  item_data?: {
    name?: string;
    description?: string | null;
    description_plaintext?: string | null;
    abbreviation?: string | null;
    product_type?: string;
    is_archived?: boolean;
    category_id?: string;
    categories?: { id: string }[];
    reporting_category?: { id: string };
    variations?: CatalogObjectT[];
  };
  item_variation_data?: {
    item_id?: string;
    name?: string | null;
    sku?: string | null;
    pricing_type?: string;
    price_money?: { amount?: number; currency?: string };
    ordinal?: number;
  };
  category_data?: { name?: string };
}

export const SearchCatalogResponse = z.object({ objects: z.array(CatalogObject).optional(), related_objects: z.array(CatalogObject).optional(), cursor: z.string().optional() });
export const RetrieveCatalogResponse = z.object({ object: CatalogObject.optional(), related_objects: z.array(CatalogObject).optional() });
export const UpsertCatalogResponse = z.object({
  catalog_object: CatalogObject.optional(),
  id_mappings: z.array(z.object({ client_object_id: z.string().optional(), object_id: z.string().optional() })).optional(),
});

export const SquareLocation = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  business_name: z.string().optional(),
  timezone: z.string().optional(),
  address: z
    .object({
      address_line_1: z.string().optional(),
      locality: z.string().optional(),
      administrative_district_level_1: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  coordinates: z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).optional(),
});
export type SquareLocation = z.infer<typeof SquareLocation>;
export const ListLocationsResponse = z.object({ locations: z.array(SquareLocation).optional() });
export const CreateLocationResponse = z.object({ location: SquareLocation.optional() });

export const MerchantResponse = z.object({ merchant: z.object({ id: z.string(), business_name: z.string().optional() }).optional() });

export const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.string().optional(),
  merchant_id: z.string().optional(),
  short_lived: z.boolean().optional(),
});

export const SearchOrdersResponse = z.object({
  orders: z
    .array(z.object({ id: z.string(), line_items: z.array(z.object({ catalog_object_id: z.string().optional(), quantity: z.string().optional(), name: z.string().optional() })).optional() }))
    .optional(),
  cursor: z.string().optional(),
});

export const WebhookSubscription = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  event_types: z.array(z.string()).optional(),
  notification_url: z.string().optional(),
  api_version: z.string().optional(),
  signature_key: z.string().optional(),
});
export const CreateSubscriptionResponse = z.object({ subscription: WebhookSubscription.optional() });
export const ListSubscriptionsResponse = z.object({ subscriptions: z.array(WebhookSubscription).optional(), cursor: z.string().optional() });
export const RotateKeyResponse = z.object({ signature_key: z.string().optional() });

/** The webhook body. Only the parts we act on. */
export const CatalogVersionUpdated = z.object({
  merchant_id: z.string().min(1),
  type: z.string(),
  event_id: z.string().optional(),
  created_at: z.string().optional(),
  data: z.object({ object: z.object({ catalog_version: z.object({ updated_at: z.string().optional() }).optional() }).optional() }).optional(),
});
export type CatalogVersionUpdated = z.infer<typeof CatalogVersionUpdated>;
