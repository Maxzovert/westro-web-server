/**
 * Customer payments + provider webhooks.
 * Browser redirects never mark orders paid — only verified webhooks (or
 * the development mock confirm that reuses the same capture logic) do.
 */
import { Router } from "express";
import { requireCustomer } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { ValidationError } from "../../../shared/errors.js";
import { sendSuccess } from "../../../shared/http.js";
import {
  createPaymentBodySchema,
  mockConfirmBodySchema,
  paymentIdParamsSchema,
  providerParamsSchema,
} from "./payments.schemas.js";
import {
  createPaymentService,
  getPaymentService,
  mockConfirmPaymentService,
  processPaymentWebhookService,
} from "./payments.service.js";

export const storePaymentsRouter = Router();
export const storePaymentWebhooksRouter = Router();

storePaymentsRouter.post(
  "/create",
  requireCustomer,
  csrfProtection,
  validateRequest({ body: createPaymentBodySchema }),
  async (req, res, next) => {
    try {
      const idempotencyKeyHeader = req.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader.trim() : "";
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new ValidationError("Idempotency-Key header is required");
      }

      const result = await createPaymentService(req.customer!.id, req.body, idempotencyKey);
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      next(error);
    }
  },
);

storePaymentsRouter.get(
  "/:id",
  requireCustomer,
  validateRequest({ params: paymentIdParamsSchema }),
  async (req, res, next) => {
    try {
      const payment = await getPaymentService(req.customer!.id, String(req.params.id));
      sendSuccess(res, payment);
    } catch (error) {
      next(error);
    }
  },
);

/** Development-only: simulate provider confirmation without trusting return URL alone. */
storePaymentsRouter.post(
  "/mock/confirm",
  requireCustomer,
  csrfProtection,
  validateRequest({ body: mockConfirmBodySchema }),
  async (req, res, next) => {
    try {
      const payment = await mockConfirmPaymentService(req.customer!.id, req.body);
      sendSuccess(res, payment);
    } catch (error) {
      next(error);
    }
  },
);

storePaymentWebhooksRouter.post(
  "/:provider",
  validateRequest({ params: providerParamsSchema }),
  async (req, res, next) => {
    try {
      const rawBody =
        typeof req.body === "string"
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body.toString("utf8")
            : JSON.stringify(req.body ?? {});

      const signatureHeader = req.headers["x-wastro-signature"];
      const signature = typeof signatureHeader === "string" ? signatureHeader : undefined;

      const result = await processPaymentWebhookService({
        provider: String(req.params.provider),
        rawBody,
        signature,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);
