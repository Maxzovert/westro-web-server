/**
 * Storefront cart persistence against shared carts / cart_items tables.
 * Prices are never stored as authority — callers reprice from catalog.
 */
import type { PoolClient } from "pg";
import { pool } from "../../../database/connection/pool.js";

type Db = PoolClient | typeof pool;

export type CartRow = {
  id: string;
  customer_id: string | null;
  session_id: string | null;
  currency: string;
  created_at: Date;
  updated_at: Date;
};

export type CartItemRow = {
  id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  created_at: Date;
  updated_at: Date;
};

export type CartItemDetailRow = {
  id: string;
  cart_id: string;
  variant_id: string;
  quantity: number;
  sku: string;
  unit_price: string;
  currency: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_status: string;
  image_url: string | null;
  available: number;
};

export async function findCartByCustomerId(
  customerId: string,
  db: Db = pool,
): Promise<CartRow | null> {
  const result = await db.query<CartRow>(
    `SELECT id, customer_id, session_id, currency, created_at, updated_at
     FROM carts
     WHERE customer_id = $1`,
    [customerId],
  );
  return result.rows[0] ?? null;
}

export async function findGuestCartBySessionId(
  sessionId: string,
  db: Db = pool,
): Promise<CartRow | null> {
  const result = await db.query<CartRow>(
    `SELECT id, customer_id, session_id, currency, created_at, updated_at
     FROM carts
     WHERE session_id = $1 AND customer_id IS NULL`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

export async function createCart(
  input: { customerId?: string | null; sessionId?: string | null; currency?: string },
  db: Db = pool,
): Promise<CartRow> {
  const result = await db.query<CartRow>(
    `INSERT INTO carts (customer_id, session_id, currency)
     VALUES ($1, $2, $3)
     RETURNING id, customer_id, session_id, currency, created_at, updated_at`,
    [input.customerId ?? null, input.sessionId ?? null, (input.currency ?? "INR").toUpperCase()],
  );
  return result.rows[0];
}

export async function touchCart(cartId: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId]);
}

export async function deleteCart(cartId: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM carts WHERE id = $1`, [cartId]);
}

export async function listCartItemDetails(
  cartId: string,
  db: Db = pool,
): Promise<CartItemDetailRow[]> {
  const result = await db.query<CartItemDetailRow>(
    `SELECT
       ci.id,
       ci.cart_id,
       ci.variant_id,
       ci.quantity,
       pv.sku,
       pv.price::text AS unit_price,
       pv.currency,
       p.id AS product_id,
       p.name AS product_name,
       p.slug AS product_slug,
       p.status AS product_status,
       (
         SELECT pi.storage_key
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.sort_order ASC, pi.created_at ASC
         LIMIT 1
       ) AS image_url,
       COALESCE(
         (
           SELECT SUM(GREATEST(il.quantity_on_hand - il.quantity_reserved, 0))::int
           FROM inventory_levels il
           INNER JOIN inventory_locations loc ON loc.id = il.location_id
           WHERE il.variant_id = pv.id AND loc.is_active = TRUE
         ),
         0
       ) AS available
     FROM cart_items ci
     INNER JOIN product_variants pv ON pv.id = ci.variant_id
     INNER JOIN products p ON p.id = pv.product_id
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC`,
    [cartId],
  );
  return result.rows;
}

export async function findCartItem(
  cartId: string,
  itemId: string,
  db: Db = pool,
): Promise<CartItemRow | null> {
  const result = await db.query<CartItemRow>(
    `SELECT id, cart_id, variant_id, quantity, created_at, updated_at
     FROM cart_items
     WHERE id = $1 AND cart_id = $2`,
    [itemId, cartId],
  );
  return result.rows[0] ?? null;
}

export async function findCartItemByVariant(
  cartId: string,
  variantId: string,
  db: Db = pool,
): Promise<CartItemRow | null> {
  const result = await db.query<CartItemRow>(
    `SELECT id, cart_id, variant_id, quantity, created_at, updated_at
     FROM cart_items
     WHERE cart_id = $1 AND variant_id = $2`,
    [cartId, variantId],
  );
  return result.rows[0] ?? null;
}

export async function upsertCartItemQuantity(
  cartId: string,
  variantId: string,
  quantity: number,
  db: Db = pool,
): Promise<CartItemRow> {
  const result = await db.query<CartItemRow>(
    `INSERT INTO cart_items (cart_id, variant_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, variant_id)
     DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
     RETURNING id, cart_id, variant_id, quantity, created_at, updated_at`,
    [cartId, variantId, quantity],
  );
  await touchCart(cartId, db);
  return result.rows[0];
}

export async function updateCartItemQuantity(
  cartId: string,
  itemId: string,
  quantity: number,
  db: Db = pool,
): Promise<CartItemRow | null> {
  const result = await db.query<CartItemRow>(
    `UPDATE cart_items
     SET quantity = $3, updated_at = now()
     WHERE id = $1 AND cart_id = $2
     RETURNING id, cart_id, variant_id, quantity, created_at, updated_at`,
    [itemId, cartId, quantity],
  );
  if (result.rows[0]) {
    await touchCart(cartId, db);
  }
  return result.rows[0] ?? null;
}

export async function deleteCartItem(
  cartId: string,
  itemId: string,
  db: Db = pool,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`,
    [itemId, cartId],
  );
  if ((result.rowCount ?? 0) > 0) {
    await touchCart(cartId, db);
    return true;
  }
  return false;
}

export async function clearCartItems(cartId: string, db: Db = pool): Promise<void> {
  await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  await touchCart(cartId, db);
}

export type SellableVariantRow = {
  variant_id: string;
  sku: string;
  price: string;
  currency: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  product_status: string;
  available: number;
};

export async function findSellableVariant(
  variantId: string,
  db: Db = pool,
): Promise<SellableVariantRow | null> {
  const result = await db.query<SellableVariantRow>(
    `SELECT
       pv.id AS variant_id,
       pv.sku,
       pv.price::text AS price,
       pv.currency,
       p.id AS product_id,
       p.name AS product_name,
       p.slug AS product_slug,
       p.status AS product_status,
       COALESCE(
         (
           SELECT SUM(GREATEST(il.quantity_on_hand - il.quantity_reserved, 0))::int
           FROM inventory_levels il
           INNER JOIN inventory_locations loc ON loc.id = il.location_id
           WHERE il.variant_id = pv.id AND loc.is_active = TRUE
         ),
         0
       ) AS available
     FROM product_variants pv
     INNER JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1`,
    [variantId],
  );
  return result.rows[0] ?? null;
}
