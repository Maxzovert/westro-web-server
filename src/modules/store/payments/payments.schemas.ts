import { z } from "zod";

export const createPaymentBodySchema = z.object({
  orderId: z.string().uuid(),
  returnUrl: z.string().url().max(1000),
});

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const providerParamsSchema = z.object({
  provider: z.string().trim().min(1).max(64),
});

export const mockConfirmBodySchema = z.object({
  paymentId: z.string().uuid(),
  outcome: z.enum(["captured", "failed"]).default("captured"),
});
