import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/pagination.js";

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional().default(""),
  categorySlug: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).optional().default("newest"),
});

export const productSlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});
