/**
 * Storefront products — read-only queries against shared catalog + inventory.
 * Hard-filters to status=active products only.
 */
import { pool } from "../../../database/connection/pool.js";

export type ProductListRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  from_price: string | null;
  currency: string | null;
  primary_image_url: string | null;
  variants_count: number;
};

export type ProductRow = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  category_name: string | null;
  category_slug: string | null;
};

export type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  attributes: Record<string, unknown>;
  price: string;
  compare_at_price: string | null;
  currency: string;
};

export type ImageRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  storage_key: string;
  sort_order: number;
};

export type AvailabilityRow = {
  variant_id: string;
  sku: string;
  available: number;
};

export type ListProductsInput = {
  search: string;
  categorySlug?: string;
  sort: "newest" | "price_asc" | "price_desc";
  limit: number;
  offset: number;
};

function buildListWhere(input: ListProductsInput): {
  whereSql: string;
  params: unknown[];
} {
  const where: string[] = ["p.status = 'active'"];
  const params: unknown[] = [];

  if (input.search) {
    params.push(`%${input.search}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length} OR EXISTS (
         SELECT 1 FROM product_variants pv_s
         WHERE pv_s.product_id = p.id AND pv_s.sku ILIKE $${params.length}
       ))`,
    );
  }

  if (input.categorySlug) {
    params.push(input.categorySlug);
    where.push(`c.slug = $${params.length} AND c.is_active = TRUE`);
  }

  return { whereSql: `WHERE ${where.join(" AND ")}`, params };
}

function sortSql(sort: ListProductsInput["sort"]): string {
  switch (sort) {
    case "price_asc":
      return "from_price ASC NULLS LAST, p.created_at DESC";
    case "price_desc":
      return "from_price DESC NULLS LAST, p.created_at DESC";
    case "newest":
    default:
      return "p.created_at DESC";
  }
}

export async function listActiveProducts(
  input: ListProductsInput,
): Promise<{ rows: ProductListRow[]; total: number }> {
  const { whereSql, params } = buildListWhere(input);

  const totalResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}`,
    params,
  );

  const listParams = [...params, input.limit, input.offset];
  const rowsResult = await pool.query<ProductListRow>(
    `SELECT
       p.id,
       p.name,
       p.slug,
       p.description,
       p.created_at,
       p.category_id,
       c.name AS category_name,
       c.slug AS category_slug,
       (
         SELECT MIN(pv.price)::text
         FROM product_variants pv
         WHERE pv.product_id = p.id
       ) AS from_price,
       (
         SELECT pv.currency
         FROM product_variants pv
         WHERE pv.product_id = p.id
         ORDER BY pv.price ASC, pv.created_at ASC
         LIMIT 1
       ) AS currency,
       (
         SELECT pi.storage_key
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.sort_order ASC, pi.created_at ASC
         LIMIT 1
       ) AS primary_image_url,
       (
         SELECT COUNT(*)::int
         FROM product_variants pv
         WHERE pv.product_id = p.id
       ) AS variants_count
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}
     ORDER BY ${sortSql(input.sort)}
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  return { rows: rowsResult.rows, total: totalResult.rows[0]?.count ?? 0 };
}

export async function findActiveProductBySlug(slug: string): Promise<ProductRow | null> {
  const result = await pool.query<ProductRow>(
    `SELECT
       p.id,
       p.category_id,
       p.name,
       p.slug,
       p.description,
       p.status,
       p.created_at,
       p.updated_at,
       c.name AS category_name,
       c.slug AS category_slug
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.is_active = TRUE
     WHERE p.slug = $1 AND p.status = 'active'`,
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function listVariantsByProductId(productId: string): Promise<VariantRow[]> {
  const result = await pool.query<VariantRow>(
    `SELECT id, product_id, sku, attributes, price::text, compare_at_price::text, currency
     FROM product_variants
     WHERE product_id = $1
     ORDER BY price ASC, created_at ASC`,
    [productId],
  );
  return result.rows;
}

export async function listImagesByProductId(productId: string): Promise<ImageRow[]> {
  const result = await pool.query<ImageRow>(
    `SELECT id, product_id, variant_id, storage_key, sort_order
     FROM product_images
     WHERE product_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [productId],
  );
  return result.rows;
}

export async function listAvailabilityByProductId(
  productId: string,
): Promise<AvailabilityRow[]> {
  const result = await pool.query<AvailabilityRow>(
    `SELECT
       pv.id AS variant_id,
       pv.sku,
       COALESCE(
         SUM(
           CASE
             WHEN loc.is_active = TRUE
               THEN GREATEST(il.quantity_on_hand - il.quantity_reserved, 0)
             ELSE 0
           END
         ),
         0
       )::int AS available
     FROM product_variants pv
     LEFT JOIN inventory_levels il ON il.variant_id = pv.id
     LEFT JOIN inventory_locations loc ON loc.id = il.location_id
     WHERE pv.product_id = $1
     GROUP BY pv.id, pv.sku
     ORDER BY pv.sku ASC`,
    [productId],
  );
  return result.rows;
}
