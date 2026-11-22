/**
 * Shared pagination helpers for storefront list endpoints.
 */
import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function paginationOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
