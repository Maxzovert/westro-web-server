/**
 * Storefront categories — read-only queries against the shared catalog tables.
 * Only active categories are returned.
 */
import { pool } from "../../../database/connection/pool.js";

export type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export async function listActiveCategories(input: {
  limit: number;
  offset: number;
}): Promise<{ rows: CategoryRow[]; total: number }> {
  const totalResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM categories WHERE is_active = TRUE`,
  );

  const rowsResult = await pool.query<CategoryRow>(
    `SELECT id, parent_id, name, slug, is_active, created_at, updated_at
     FROM categories
     WHERE is_active = TRUE
     ORDER BY name ASC
     LIMIT $1 OFFSET $2`,
    [input.limit, input.offset],
  );

  return { rows: rowsResult.rows, total: totalResult.rows[0]?.count ?? 0 };
}

export async function findActiveCategoryBySlug(slug: string): Promise<CategoryRow | null> {
  const result = await pool.query<CategoryRow>(
    `SELECT id, parent_id, name, slug, is_active, created_at, updated_at
     FROM categories
     WHERE slug = $1 AND is_active = TRUE`,
    [slug],
  );
  return result.rows[0] ?? null;
}
