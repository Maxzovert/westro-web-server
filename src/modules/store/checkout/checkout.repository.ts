import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../database/connection/pool.js";

type Db = PoolClient | typeof pool;

export type OrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  status: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  shipping_amount: string;
  total_amount: string;
  shipping_method_id: string | null;
  customer_note: string | null;
  shipping_address_snapshot: Record<string, unknown> | null;
  coupon_code: string | null;
  placed_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  variant_id: string | null;
  sku_snapshot: string;
  name_snapshot: string;
  unit_price: string;
  quantity: number;
  line_total: string;
};

export type IdempotencyRow = {
  id: string;
  customer_id: string;
  scope: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
};

export type InventoryLevelLock = {
  variant_id: string;
  location_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  location_code: string;
};

export function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createOrderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `WAS-${stamp}-${suffix}`;
}

export async function findIdempotencyRecord(
  customerId: string,
  scope: string,
  key: string,
  db: Db = pool,
): Promise<IdempotencyRow | null> {
  const result = await db.query<IdempotencyRow>(
    `SELECT id, customer_id, scope, idempotency_key, request_hash, response_status, response_body
     FROM store_idempotency_keys
     WHERE customer_id = $1 AND scope = $2 AND idempotency_key = $3`,
    [customerId, scope, key],
  );
  return result.rows[0] ?? null;
}

export async function saveIdempotencyRecord(
  input: {
    customerId: string;
    scope: string;
    key: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO store_idempotency_keys (
       customer_id, scope, idempotency_key, request_hash, response_status, response_body
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (customer_id, scope, idempotency_key) DO NOTHING`,
    [
      input.customerId,
      input.scope,
      input.key,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseBody),
    ],
  );
}

export async function createOrder(
  input: {
    orderNumber: string;
    customerId: string;
    currency: string;
    subtotal: number;
    discount: number;
    tax: number;
    shipping: number;
    total: number;
    shippingMethodId: string;
    customerNote: string | null;
    shippingAddressSnapshot: Record<string, unknown>;
    couponCode: string | null;
  },
  db: PoolClient,
): Promise<OrderRow> {
  const result = await db.query<OrderRow>(
    `INSERT INTO orders (
       order_number, customer_id, status, currency,
       subtotal_amount, discount_amount, tax_amount, shipping_amount, total_amount,
       shipping_method_id, customer_note, shipping_address_snapshot, coupon_code
     ) VALUES (
       $1, $2, 'pending', $3,
       $4, $5, $6, $7, $8,
       $9, $10, $11::jsonb, $12
     )
     RETURNING
       id, order_number, customer_id, status, currency,
       subtotal_amount::text, discount_amount::text, tax_amount::text,
       shipping_amount::text, total_amount::text,
       shipping_method_id, customer_note, shipping_address_snapshot, coupon_code,
       placed_at, created_at, updated_at`,
    [
      input.orderNumber,
      input.customerId,
      input.currency,
      input.subtotal,
      input.discount,
      input.tax,
      input.shipping,
      input.total,
      input.shippingMethodId,
      input.customerNote,
      JSON.stringify(input.shippingAddressSnapshot),
      input.couponCode,
    ],
  );
  return result.rows[0];
}

export async function insertOrderItem(
  input: {
    orderId: string;
    variantId: string;
    sku: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  },
  db: PoolClient,
): Promise<OrderItemRow> {
  const result = await db.query<OrderItemRow>(
    `INSERT INTO order_items (
       order_id, variant_id, sku_snapshot, name_snapshot, unit_price, quantity, line_total
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id, order_id, variant_id, sku_snapshot, name_snapshot,
       unit_price::text, quantity, line_total::text`,
    [
      input.orderId,
      input.variantId,
      input.sku,
      input.name,
      input.unitPrice,
      input.quantity,
      input.lineTotal,
    ],
  );
  return result.rows[0];
}

export async function insertOrderStatusHistory(
  input: {
    orderId: string;
    fromStatus: string | null;
    toStatus: string;
    note?: string | null;
  },
  db: PoolClient,
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4)`,
    [input.orderId, input.fromStatus, input.toStatus, input.note ?? null],
  );
}

export async function lockInventoryLevelsForVariant(
  variantId: string,
  db: PoolClient,
): Promise<InventoryLevelLock[]> {
  const result = await db.query<InventoryLevelLock>(
    `SELECT
       il.variant_id,
       il.location_id,
       il.quantity_on_hand,
       il.quantity_reserved,
       loc.code AS location_code
     FROM inventory_levels il
     INNER JOIN inventory_locations loc ON loc.id = il.location_id
     WHERE il.variant_id = $1 AND loc.is_active = TRUE
     ORDER BY CASE WHEN loc.code = 'DEFAULT' THEN 0 ELSE 1 END, loc.name ASC
     FOR UPDATE OF il`,
    [variantId],
  );
  return result.rows;
}

export async function updateInventoryOnHand(
  input: {
    variantId: string;
    locationId: string;
    quantityOnHand: number;
    quantityReserved: number;
  },
  db: PoolClient,
): Promise<void> {
  await db.query(
    `UPDATE inventory_levels
     SET quantity_on_hand = $3,
         quantity_reserved = $4,
         updated_at = now()
     WHERE variant_id = $1 AND location_id = $2`,
    [input.variantId, input.locationId, input.quantityOnHand, input.quantityReserved],
  );
}

export async function insertInventoryMovement(
  input: {
    variantId: string;
    locationId: string;
    delta: number;
    reason: string;
    referenceId: string;
  },
  db: PoolClient,
): Promise<void> {
  await db.query(
    `INSERT INTO inventory_movements (variant_id, location_id, delta, reason, reference_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.variantId, input.locationId, input.delta, input.reason, input.referenceId],
  );
}

export async function listOrdersByCustomer(
  customerId: string,
  limit: number,
  offset: number,
): Promise<{ rows: OrderRow[]; total: number }> {
  const totalResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM orders WHERE customer_id = $1`,
    [customerId],
  );
  const rowsResult = await pool.query<OrderRow>(
    `SELECT
       id, order_number, customer_id, status, currency,
       subtotal_amount::text, discount_amount::text, tax_amount::text,
       shipping_amount::text, total_amount::text,
       shipping_method_id, customer_note, shipping_address_snapshot, coupon_code,
       placed_at, created_at, updated_at
     FROM orders
     WHERE customer_id = $1
     ORDER BY placed_at DESC
     LIMIT $2 OFFSET $3`,
    [customerId, limit, offset],
  );
  return { rows: rowsResult.rows, total: totalResult.rows[0]?.count ?? 0 };
}

export async function findOrderForCustomer(
  customerId: string,
  orderId: string,
): Promise<OrderRow | null> {
  const result = await pool.query<OrderRow>(
    `SELECT
       id, order_number, customer_id, status, currency,
       subtotal_amount::text, discount_amount::text, tax_amount::text,
       shipping_amount::text, total_amount::text,
       shipping_method_id, customer_note, shipping_address_snapshot, coupon_code,
       placed_at, created_at, updated_at
     FROM orders
     WHERE id = $1 AND customer_id = $2`,
    [orderId, customerId],
  );
  return result.rows[0] ?? null;
}

export async function listOrderItems(orderId: string): Promise<OrderItemRow[]> {
  const result = await pool.query<OrderItemRow>(
    `SELECT
       id, order_id, variant_id, sku_snapshot, name_snapshot,
       unit_price::text, quantity, line_total::text
     FROM order_items
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [orderId],
  );
  return result.rows;
}

export async function findLatestPaymentStatus(
  orderId: string,
): Promise<{ id: string; status: string } | null> {
  const result = await pool.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM payments
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

export async function findShipmentSummary(
  orderId: string,
): Promise<{ trackingNumber: string | null; status: string } | null> {
  const result = await pool.query<{ tracking_number: string | null; status: string }>(
    `SELECT tracking_number, status
     FROM shipments
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { trackingNumber: row.tracking_number, status: row.status };
}
