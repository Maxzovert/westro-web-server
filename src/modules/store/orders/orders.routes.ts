/**
 * Customer order history — ownership enforced in queries.
 */
import { Router } from "express";
import { requireCustomer } from "../../../middleware/auth.js";
import { validateRequest } from "../../../middleware/validate.js";
import { buildPaginationMeta, sendSuccess } from "../../../shared/http.js";
import {
  listOrdersQuerySchema,
  orderIdParamsSchema,
} from "../checkout/checkout.schemas.js";
import { getOrderService, listOrdersService } from "../checkout/checkout.service.js";

export const storeOrdersRouter = Router();

storeOrdersRouter.use(requireCustomer);

storeOrdersRouter.get(
  "/",
  validateRequest({ query: listOrdersQuerySchema }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { page: number; pageSize: number };
      const result = await listOrdersService(req.customer!.id, query);
      sendSuccess(res, result.items, {
        meta: {
          pagination: buildPaginationMeta(query.page, query.pageSize, result.total),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

storeOrdersRouter.get(
  "/:id",
  validateRequest({ params: orderIdParamsSchema }),
  async (req, res, next) => {
    try {
      const order = await getOrderService(req.customer!.id, String(req.params.id));
      sendSuccess(res, order);
    } catch (error) {
      next(error);
    }
  },
);
