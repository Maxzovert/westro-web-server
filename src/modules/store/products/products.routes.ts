/**
 * Store products (public read)
 * ----------------------------
 * Active products only. Never accept client status overrides.
 */
import { Router } from "express";
import { validateRequest } from "../../../middleware/validate.js";
import { buildPaginationMeta, sendSuccess } from "../../../shared/http.js";
import { listProductsQuerySchema, productSlugParamsSchema } from "./products.schemas.js";
import {
  getStoreProductAvailabilityService,
  getStoreProductBySlugService,
  listStoreProductsService,
} from "./products.service.js";

export const storeProductsRouter = Router();

storeProductsRouter.get(
  "/",
  validateRequest({ query: listProductsQuerySchema }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as {
        page: number;
        pageSize: number;
        search: string;
        categorySlug?: string;
        sort: "newest" | "price_asc" | "price_desc";
      };
      const result = await listStoreProductsService(query);
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

storeProductsRouter.get(
  "/:slug/availability",
  validateRequest({ params: productSlugParamsSchema }),
  async (req, res, next) => {
    try {
      const availability = await getStoreProductAvailabilityService(String(req.params.slug));
      sendSuccess(res, availability);
    } catch (error) {
      next(error);
    }
  },
);

storeProductsRouter.get(
  "/:slug",
  validateRequest({ params: productSlugParamsSchema }),
  async (req, res, next) => {
    try {
      const product = await getStoreProductBySlugService(String(req.params.slug));
      sendSuccess(res, product);
    } catch (error) {
      next(error);
    }
  },
);
