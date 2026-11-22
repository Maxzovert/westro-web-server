/**
 * Shipping options for checkout.
 */
import { Router } from "express";
import { requireCustomer } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { sendSuccess } from "../../../shared/http.js";
import { shippingOptionsBodySchema } from "../checkout/checkout.schemas.js";
import { getShippingOptionsService } from "../checkout/checkout.service.js";

export const storeShippingRouter = Router();

storeShippingRouter.post(
  "/options",
  requireCustomer,
  csrfProtection,
  validateRequest({ body: shippingOptionsBodySchema }),
  async (req, res, next) => {
    try {
      const options = await getShippingOptionsService(
        req.customer!.id,
        req.body.addressId,
      );
      sendSuccess(res, options);
    } catch (error) {
      next(error);
    }
  },
);
