/**
 * Checkout quote + place-order (customer only; guestCheckout disabled).
 */
import { Router } from "express";
import { requireCustomer } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { ValidationError } from "../../../shared/errors.js";
import { sendSuccess } from "../../../shared/http.js";
import { checkoutBodySchema } from "./checkout.schemas.js";
import { placeOrderService, quoteCheckoutService } from "./checkout.service.js";

export const storeCheckoutRouter = Router();

storeCheckoutRouter.use(requireCustomer);

storeCheckoutRouter.post(
  "/quote",
  csrfProtection,
  validateRequest({ body: checkoutBodySchema }),
  async (req, res, next) => {
    try {
      const quote = await quoteCheckoutService(req.customer!.id, req.body);
      sendSuccess(res, quote);
    } catch (error) {
      next(error);
    }
  },
);

storeCheckoutRouter.post(
  "/place-order",
  csrfProtection,
  validateRequest({ body: checkoutBodySchema }),
  async (req, res, next) => {
    try {
      const idempotencyKeyHeader = req.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader.trim() : "";

      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new ValidationError("Idempotency-Key header is required");
      }

      const result = await placeOrderService(req.customer!.id, req.body, idempotencyKey);
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      next(error);
    }
  },
);
