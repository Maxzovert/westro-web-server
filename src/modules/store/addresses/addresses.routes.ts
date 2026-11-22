/**
 * Customer address book
 * ---------------------
 * Ownership is enforced via customer_id from the session on every query.
 */
import { Router } from "express";
import { requireCustomer } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { sendSuccess } from "../../../shared/http.js";
import {
  addressBodySchema,
  addressIdParamsSchema,
  updateAddressBodySchema,
} from "./addresses.schemas.js";
import {
  createAddressService,
  deleteAddressService,
  listAddressesService,
  updateAddressService,
} from "./addresses.service.js";

export const storeAddressesRouter = Router();

storeAddressesRouter.use(requireCustomer);

storeAddressesRouter.get("/", async (req, res, next) => {
  try {
    const items = await listAddressesService(req.customer!.id);
    sendSuccess(res, items);
  } catch (error) {
    next(error);
  }
});

storeAddressesRouter.post(
  "/",
  csrfProtection,
  validateRequest({ body: addressBodySchema }),
  async (req, res, next) => {
    try {
      const address = await createAddressService(req.customer!.id, req.body);
      sendSuccess(res, address, { statusCode: 201 });
    } catch (error) {
      next(error);
    }
  },
);

storeAddressesRouter.patch(
  "/:id",
  csrfProtection,
  validateRequest({ params: addressIdParamsSchema, body: updateAddressBodySchema }),
  async (req, res, next) => {
    try {
      const address = await updateAddressService(
        req.customer!.id,
        String(req.params.id),
        req.body,
      );
      sendSuccess(res, address);
    } catch (error) {
      next(error);
    }
  },
);

storeAddressesRouter.delete(
  "/:id",
  csrfProtection,
  validateRequest({ params: addressIdParamsSchema }),
  async (req, res, next) => {
    try {
      const result = await deleteAddressService(req.customer!.id, String(req.params.id));
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);
