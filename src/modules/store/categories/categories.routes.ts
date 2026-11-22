/**
 * Store categories (public read)
 * ------------------------------
 * Active categories only — never expose inactive Admin drafts.
 */
import { Router } from "express";
import { validateRequest } from "../../../middleware/validate.js";
import { buildPaginationMeta, sendSuccess } from "../../../shared/http.js";
import {
  categorySlugParamsSchema,
  listCategoriesQuerySchema,
} from "./categories.schemas.js";
import {
  getStoreCategoryBySlugService,
  listStoreCategoriesService,
} from "./categories.service.js";

export const storeCategoriesRouter = Router();

storeCategoriesRouter.get(
  "/",
  validateRequest({ query: listCategoriesQuerySchema }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { page: number; pageSize: number };
      const result = await listStoreCategoriesService(query);
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

storeCategoriesRouter.get(
  "/:slug",
  validateRequest({ params: categorySlugParamsSchema }),
  async (req, res, next) => {
    try {
      const category = await getStoreCategoryBySlugService(String(req.params.slug));
      sendSuccess(res, category);
    } catch (error) {
      next(error);
    }
  },
);
