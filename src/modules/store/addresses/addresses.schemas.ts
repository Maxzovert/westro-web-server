import { z } from "zod";

export const addressBodySchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(32).nullable().optional(),
  country: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional()
    .default("IN"),
  addressType: z.enum(["shipping", "billing", "other"]).optional().default("shipping"),
  isDefault: z.boolean().optional().default(false),
});

export const updateAddressBodySchema = addressBodySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" },
);

export const addressIdParamsSchema = z.object({
  id: z.string().uuid(),
});
