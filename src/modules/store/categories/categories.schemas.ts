import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/pagination.js";

export const listCategoriesQuerySchema = paginationQuerySchema;

export const categorySlugParamsSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});
