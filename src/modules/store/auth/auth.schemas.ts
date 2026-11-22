import { z } from "zod";

export const registerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().trim().email().max(320),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8).max(128),
});

export const otpRequestBodySchema = z.object({
  phone: z.string().trim().min(10).max(20),
});

export const otpVerifyBodySchema = z.object({
  phone: z.string().trim().min(10).max(20),
  otp: z.string().trim().min(4).max(8),
});
