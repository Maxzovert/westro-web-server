import { z } from "zod";

export const addCartItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(99),
});

export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99),
});

export const cartItemIdParamsSchema = z.object({
  itemId: z.string().uuid(),
});
