import type { PoolClient } from "pg";
import { pool } from "../../../database/connection/pool.js";

type Db = PoolClient | typeof pool;

export type PaymentRow = {
  id: string;
  order_id: string;
  provider: string;
  provider_reference: string | null;
  amount: string;
  currency: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

export type PayableOrderRow = {
  id: string;
  order_number: string;
  customer_id: string | null;
  status: string;
  currency: string;
  total_amount: string;
};

export async function findPayableOrderForCustomer(
  customerId: string,
  orderId: string,
  db: Db = pool,
): Promise<PayableOrderRow | null> {
  const result = await db.query<PayableOrderRow>(
    `SELECT id, order_number, customer_id, status, currency, total_amount::text
     FROM orders
     WHERE id = $1 AND customer_id = $2`,
    [orderId, customerId],
  );
  return result.rows[0] ?? null;
}

export async function findPaymentById(paymentId: string, db: Db = pool): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow>(
    `SELECT
       id, order_id, provider, provider_reference, amount::text, currency, status,
       created_at, updated_at
     FROM payments
     WHERE id = $1`,
    [paymentId],
  );
  return result.rows[0] ?? null;
}

export async function findPaymentForCustomer(
  customerId: string,
  paymentId: string,
  db: Db = pool,
): Promise<(PaymentRow & { order_number: string; order_status: string }) | null> {
  const result = await db.query<PaymentRow & { order_number: string; order_status: string }>(
    `SELECT
       p.id, p.order_id, p.provider, p.provider_reference, p.amount::text, p.currency, p.status,
       p.created_at, p.updated_at,
       o.order_number, o.status AS order_status
     FROM payments p
     INNER JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1 AND o.customer_id = $2`,
    [paymentId, customerId],
  );
  return result.rows[0] ?? null;
}

export async function findLatestPendingPaymentForOrder(
  orderId: string,
  db: Db = pool,
): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow>(
    `SELECT
       id, order_id, provider, provider_reference, amount::text, currency, status,
       created_at, updated_at
     FROM payments
     WHERE order_id = $1 AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

export async function createPayment(
  input: {
    orderId: string;
    provider: string;
    providerReference: string;
    amount: number;
    currency: string;
  },
  db: Db = pool,
): Promise<PaymentRow> {
  const result = await db.query<PaymentRow>(
    `INSERT INTO payments (order_id, provider, provider_reference, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING
       id, order_id, provider, provider_reference, amount::text, currency, status,
       created_at, updated_at`,
    [
      input.orderId,
      input.provider,
      input.providerReference,
      input.amount,
      input.currency,
    ],
  );
  return result.rows[0];
}

export async function updatePaymentStatus(
  paymentId: string,
  status: string,
  db: Db = pool,
): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow>(
    `UPDATE payments
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING
       id, order_id, provider, provider_reference, amount::text, currency, status,
       created_at, updated_at`,
    [paymentId, status],
  );
  return result.rows[0] ?? null;
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE orders
     SET status = $2, updated_at = now()
     WHERE id = $1`,
    [orderId, status],
  );
}

export async function insertOrderStatusHistory(
  input: {
    orderId: string;
    fromStatus: string | null;
    toStatus: string;
    note?: string | null;
  },
  db: Db = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4)`,
    [input.orderId, input.fromStatus, input.toStatus, input.note ?? null],
  );
}

export async function findWebhookEvent(
  provider: string,
  eventId: string,
  db: Db = pool,
): Promise<{ id: string } | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM payment_webhook_events WHERE provider = $1 AND event_id = $2`,
    [provider, eventId],
  );
  return result.rows[0] ?? null;
}

export async function insertWebhookEvent(
  input: {
    provider: string;
    eventId: string;
    paymentId: string | null;
    eventType: string;
    payload: unknown;
  },
  db: Db = pool,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO payment_webhook_events (provider, event_id, payment_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [
      input.provider,
      input.eventId,
      input.paymentId,
      input.eventType,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findIdempotencyRecord(
  customerId: string,
  scope: string,
  key: string,
  db: Db = pool,
): Promise<{
  request_hash: string;
  response_status: number;
  response_body: unknown;
} | null> {
  const result = await db.query<{
    request_hash: string;
    response_status: number;
    response_body: unknown;
  }>(
    `SELECT request_hash, response_status, response_body
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
