import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env.js";
import { withTransaction } from "../../../database/connection/pool.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors.js";
import {
  createPayment,
  findIdempotencyRecord,
  findLatestPendingPaymentForOrder,
  findPayableOrderForCustomer,
  findPaymentById,
  findPaymentForCustomer,
  findWebhookEvent,
  insertOrderStatusHistory,
  insertWebhookEvent,
  saveIdempotencyRecord,
  updateOrderStatus,
  updatePaymentStatus,
  type PaymentRow,
} from "./payments.repository.js";

const PROVIDER = "mock";

export type CreatePaymentResult = {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  redirectUrl: string;
};

export type PaymentDto = {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  providerReference: string | null;
  createdAt: string;
};

function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function formatMoney(value: string | number): string {
  return Number(value).toFixed(2);
}

function buildRedirectUrl(paymentId: string, returnUrl: string): string {
  const base = env.CLIENT_ORIGIN.replace(/\/$/, "");
  const url = new URL(`${base}/checkout/pay/${paymentId}`);
  url.searchParams.set("returnUrl", returnUrl);
  return url.toString();
}

function toCreateResult(
  payment: PaymentRow,
  orderNumber: string,
  returnUrl: string,
): CreatePaymentResult {
  return {
    paymentId: payment.id,
    orderId: payment.order_id,
    orderNumber,
    amount: formatMoney(payment.amount),
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    redirectUrl: buildRedirectUrl(payment.id, returnUrl),
  };
}

export function signWebhookPayload(rawBody: string): string {
  return createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = signWebhookPayload(rawBody);
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function markPaymentOutcome(input: {
  paymentId: string;
  outcome: "captured" | "failed";
  eventId: string;
  provider: string;
  payload: unknown;
}): Promise<{ payment: PaymentRow; alreadyProcessed: boolean }> {
  return withTransaction(async (client) => {
    const existingEvent = await findWebhookEvent(input.provider, input.eventId, client);
    if (existingEvent) {
      const payment = await findPaymentById(input.paymentId, client);
      if (!payment) throw new NotFoundError("Payment not found");
      return { payment, alreadyProcessed: true };
    }

    const payment = await findPaymentById(input.paymentId, client);
    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (payment.provider !== input.provider) {
      throw new ValidationError("Provider mismatch for payment");
    }

    const inserted = await insertWebhookEvent(
      {
        provider: input.provider,
        eventId: input.eventId,
        paymentId: payment.id,
        eventType: input.outcome === "captured" ? "payment.captured" : "payment.failed",
        payload: input.payload,
      },
      client,
    );

    if (!inserted) {
      return { payment, alreadyProcessed: true };
    }

    if (payment.status === "captured" || payment.status === "failed") {
      return { payment, alreadyProcessed: true };
    }

    const nextStatus = input.outcome === "captured" ? "captured" : "failed";
    const updatedPayment = await updatePaymentStatus(payment.id, nextStatus, client);
    if (!updatedPayment) {
      throw new NotFoundError("Payment not found");
    }

    if (input.outcome === "captured") {
      await updateOrderStatus(payment.order_id, "paid", client);
      await insertOrderStatusHistory(
        {
          orderId: payment.order_id,
          fromStatus: "pending",
          toStatus: "paid",
          note: "Payment captured via provider webhook",
        },
        client,
      );
    }

    return { payment: updatedPayment, alreadyProcessed: false };
  });
}

export async function createPaymentService(
  customerId: string,
  input: { orderId: string; returnUrl: string },
  idempotencyKey: string,
): Promise<{ statusCode: number; body: { data: CreatePaymentResult } }> {
  const requestHash = hashRequestPayload(input);
  const existing = await findIdempotencyRecord(customerId, "payment-create", idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ConflictError("Idempotency key was reused with a different payload");
    }
    return {
      statusCode: existing.response_status,
      body: existing.response_body as { data: CreatePaymentResult },
    };
  }

  const order = await findPayableOrderForCustomer(customerId, input.orderId);
  if (!order) {
    throw new NotFoundError("Order not found");
  }
  if (order.status !== "pending") {
    throw new ValidationError("Order is not payable", { status: order.status });
  }

  const pending = await findLatestPendingPaymentForOrder(order.id);
  let payment = pending;
  if (!payment) {
    payment = await createPayment({
      orderId: order.id,
      provider: PROVIDER,
      providerReference: `mock_${randomBytes(8).toString("hex")}`,
      amount: Number(order.total_amount),
      currency: order.currency,
    });
  }

  const data = toCreateResult(payment, order.order_number, input.returnUrl);
  const body = { data };
  await saveIdempotencyRecord({
    customerId,
    scope: "payment-create",
    key: idempotencyKey,
    requestHash,
    responseStatus: 201,
    responseBody: body,
  });

  return { statusCode: 201, body };
}

export async function getPaymentService(customerId: string, paymentId: string): Promise<PaymentDto> {
  const payment = await findPaymentForCustomer(customerId, paymentId);
  if (!payment) {
    throw new NotFoundError("Payment not found");
  }

  return {
    id: payment.id,
    orderId: payment.order_id,
    orderNumber: payment.order_number,
    orderStatus: payment.order_status,
    amount: formatMoney(payment.amount),
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    providerReference: payment.provider_reference,
    createdAt: payment.created_at.toISOString(),
  };
}

/**
 * Dev-only helper: simulates the provider sending a signed webhook.
 * Browser return/redirect alone never marks an order paid.
 */
export async function mockConfirmPaymentService(
  customerId: string,
  input: { paymentId: string; outcome: "captured" | "failed" },
): Promise<PaymentDto> {
  if (env.NODE_ENV === "production") {
    throw new ForbiddenError("Mock payment confirm is disabled in production");
  }

  const payment = await findPaymentForCustomer(customerId, input.paymentId);
  if (!payment) {
    throw new NotFoundError("Payment not found");
  }
  if (payment.status !== "pending") {
    return getPaymentService(customerId, payment.id);
  }

  const eventId = `evt_mock_${payment.id}_${input.outcome}`;
  const payload = {
    id: eventId,
    type: input.outcome === "captured" ? "payment.captured" : "payment.failed",
    data: {
      paymentId: payment.id,
      providerReference: payment.provider_reference,
      amount: payment.amount,
      currency: payment.currency,
    },
  };

  await markPaymentOutcome({
    paymentId: payment.id,
    outcome: input.outcome,
    eventId,
    provider: PROVIDER,
    payload,
  });

  return getPaymentService(customerId, payment.id);
}

export async function processPaymentWebhookService(input: {
  provider: string;
  rawBody: string;
  signature?: string;
}): Promise<{ ok: true; duplicate: boolean }> {
  if (input.provider !== PROVIDER) {
    throw new NotFoundError("Unknown payment provider");
  }

  if (!verifyWebhookSignature(input.rawBody, input.signature)) {
    throw new AppError("Invalid webhook signature", {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  let parsed: {
    id?: string;
    type?: string;
    data?: { paymentId?: string };
  };
  try {
    parsed = JSON.parse(input.rawBody) as typeof parsed;
  } catch {
    throw new ValidationError("Invalid webhook payload");
  }

  const eventId = parsed.id?.trim();
  const paymentId = parsed.data?.paymentId?.trim();
  const type = parsed.type?.trim();

  if (!eventId || !paymentId || !type) {
    throw new ValidationError("Webhook payload missing required fields");
  }

  const outcome =
    type === "payment.captured" || type === "payment.paid"
      ? "captured"
      : type === "payment.failed"
        ? "failed"
        : null;

  if (!outcome) {
    // Acknowledge unknown event types without failing the provider retry loop.
    const inserted = await insertWebhookEvent({
      provider: input.provider,
      eventId,
      paymentId,
      eventType: type,
      payload: parsed,
    });
    return { ok: true, duplicate: !inserted };
  }

  const result = await markPaymentOutcome({
    paymentId,
    outcome,
    eventId,
    provider: input.provider,
    payload: parsed,
  });

  return { ok: true, duplicate: result.alreadyProcessed };
}
