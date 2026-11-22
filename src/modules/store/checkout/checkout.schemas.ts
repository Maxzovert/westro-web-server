import { z } from "zod";

export const checkoutBodySchema = z.object({
  addressId: z.string().uuid(),
  shippingMethodId: z.string().trim().min(1).max(64),
  couponCode: z.string().trim().max(64).nullable().optional(),
  customerNote: z.string().trim().max(1000).nullable().optional(),
});

export const shippingOptionsBodySchema = z.object({
  addressId: z.string().uuid().optional(),
});

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
});
