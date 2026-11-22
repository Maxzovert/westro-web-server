/**
 * Store cart (guest or customer)
 * ------------------------------
 * Mutations require CSRF. Totals are always server-priced from catalog.
 */
import type { Request } from "express";
import { Router } from "express";
import { csrfProtection } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { sendSuccess } from "../../../shared/http.js";
import {
  addCartItemSchema,
  cartItemIdParamsSchema,
  updateCartItemSchema,
} from "./cart.schemas.js";
import {
  addCartItemService,
  clearCartService,
  getCartService,
  removeCartItemService,
  updateCartItemService,
  type CartOwner,
} from "./cart.service.js";

export const storeCartRouter = Router();

function cartOwnerFromRequest(req: Request): CartOwner {
  return {
    customerId: req.session.customerId,
    sessionId: req.sessionID,
  };
}

storeCartRouter.get("/", async (req, res, next) => {
  try {
    const cart = await getCartService(cartOwnerFromRequest(req));
    sendSuccess(res, cart);
  } catch (error) {
    next(error);
  }
});

storeCartRouter.post(
  "/items",
  csrfProtection,
  validateRequest({ body: addCartItemSchema }),
  async (req, res, next) => {
    try {
      const cart = await addCartItemService(cartOwnerFromRequest(req), req.body);
      sendSuccess(res, cart, { statusCode: 201 });
    } catch (error) {
      next(error);
    }
  },
);

storeCartRouter.patch(
  "/items/:itemId",
  csrfProtection,
  validateRequest({ params: cartItemIdParamsSchema, body: updateCartItemSchema }),
  async (req, res, next) => {
    try {
      const cart = await updateCartItemService(
        cartOwnerFromRequest(req),
        String(req.params.itemId),
        req.body.quantity,
      );
      sendSuccess(res, cart);
    } catch (error) {
      next(error);
    }
  },
);

storeCartRouter.delete(
  "/items/:itemId",
  csrfProtection,
  validateRequest({ params: cartItemIdParamsSchema }),
  async (req, res, next) => {
    try {
      const cart = await removeCartItemService(
        cartOwnerFromRequest(req),
        String(req.params.itemId),
      );
      sendSuccess(res, cart);
    } catch (error) {
      next(error);
    }
  },
);

storeCartRouter.delete("/", csrfProtection, async (req, res, next) => {
  try {
    const cart = await clearCartService(cartOwnerFromRequest(req));
    sendSuccess(res, cart);
  } catch (error) {
    next(error);
  }
});
