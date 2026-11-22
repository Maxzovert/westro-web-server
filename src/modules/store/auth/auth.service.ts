import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { Request } from "express";
import { env } from "../../../config/env.js";
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from "../../../shared/errors.js";
import { mergeGuestCartIntoCustomer } from "../cart/cart.service.js";
import {
  claimCustomerAccount,
  consumeOtpChallenge,
  createCustomerAccount,
  createOtpChallenge,
  createPasswordReset,
  createResetToken,
  findCustomerById,
  findCustomerByNormalizedEmail,
  findCustomerByPhone,
  findValidOtpChallenge,
  findValidPasswordReset,
  hashResetToken,
  invalidateCustomerPasswordResets,
  markPasswordResetUsed,
  normalizeEmail,
  normalizePhone,
  updateCustomerPassword,
  type CustomerAuthRow,
} from "./auth.repository.js";

export type CustomerProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

/** Fixed development OTP login credentials. */
export const DEV_OTP_PHONE = "9999900000";
export const DEV_OTP_CODE = "959945";

const INVALID_CREDENTIALS = "Invalid email or password";
const INVALID_OTP = "Invalid phone number or OTP";
const RESET_TTL_MS = 30 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function toProfile(customer: CustomerAuthRow): CustomerProfile {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone,
  };
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

async function getOrCreatePhoneCustomer(phone: string): Promise<CustomerAuthRow> {
  const existing = await findCustomerByPhone(phone);
  if (existing) {
    if (!existing.is_active) {
      throw new UnauthorizedError(INVALID_OTP);
    }
    if (!existing.password_hash) {
      const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
      await updateCustomerPassword(existing.id, passwordHash);
      const refreshed = await findCustomerById(existing.id);
      if (!refreshed) throw new UnauthorizedError(INVALID_OTP);
      return refreshed;
    }
    return existing;
  }

  const email = `otp.${phone}@wastro.local`;
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
  return createCustomerAccount({
    name: phone === DEV_OTP_PHONE ? "Dev Customer" : `Customer ${phone.slice(-4)}`,
    email,
    normalizedEmail: normalizeEmail(email),
    passwordHash,
    phone,
  });
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function establishCustomerSession(
  req: Request,
  customer: CustomerAuthRow,
  guestSessionId?: string,
): Promise<CustomerProfile> {
  await regenerateSession(req);
  const now = Date.now();
  req.session.customerId = customer.id;
  req.session.createdAt = now;
  req.session.lastSeenAt = now;
  await saveSession(req);

  if (guestSessionId) {
    await mergeGuestCartIntoCustomer(guestSessionId, customer.id);
  }

  return toProfile(customer);
}

export async function registerCustomer(
  req: Request,
  input: { name: string; email: string; password: string },
): Promise<CustomerProfile> {
  const email = input.email.trim();
  const normalized = normalizeEmail(email);
  const existing = await findCustomerByNormalizedEmail(normalized);

  if (existing?.password_hash) {
    throw new ConflictError("An account with that email already exists");
  }

  if (existing && !existing.password_hash) {
    // Claim a pre-existing order-only customer row by attaching credentials.
    const passwordHash = await hashPassword(input.password);
    const updated = await claimCustomerAccount(existing.id, {
      name: input.name.trim(),
      email,
      normalizedEmail: normalized,
      passwordHash,
    });
    const guestSessionId = req.sessionID;
    return establishCustomerSession(req, updated, guestSessionId);
  }

  const passwordHash = await hashPassword(input.password);
  try {
    const customer = await createCustomerAccount({
      name: input.name.trim(),
      email,
      normalizedEmail: normalized,
      passwordHash,
    });
    const guestSessionId = req.sessionID;
    return establishCustomerSession(req, customer, guestSessionId);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new ConflictError("An account with that email already exists");
    }
    throw error;
  }
}

export async function loginCustomer(
  req: Request,
  email: string,
  password: string,
): Promise<CustomerProfile> {
  const normalized = normalizeEmail(email);
  const customer = await findCustomerByNormalizedEmail(normalized);
  const guestSessionId = req.sessionID;

  if (!customer || !customer.is_active || !customer.password_hash) {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  const valid = await verifyPassword(customer.password_hash, password);
  if (!valid) {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  return establishCustomerSession(req, customer, guestSessionId);
}

export async function logoutCustomer(req: Request): Promise<void> {
  await destroySession(req);
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile> {
  const customer = await findCustomerById(customerId);
  if (!customer || !customer.is_active) {
    throw new UnauthorizedError("Account is inactive or not found");
  }
  return toProfile(customer);
}

export async function forgotPassword(email: string): Promise<{
  ok: true;
  message: string;
  devResetToken?: string;
}> {
  const normalized = normalizeEmail(email);
  const customer = await findCustomerByNormalizedEmail(normalized);
  const message = "If an account exists for that email, a reset link has been sent.";

  if (!customer || !customer.is_active || !customer.password_hash) {
    return { ok: true, message };
  }

  await invalidateCustomerPasswordResets(customer.id);
  const token = createResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await createPasswordReset(customer.id, hashResetToken(token), expiresAt);

  if (env.NODE_ENV !== "production") {
    console.info(`[dev] password reset token for ${normalized}: ${token}`);
    return { ok: true, message, devResetToken: token };
  }

  return { ok: true, message };
}

export async function resetPassword(token: string, password: string): Promise<{ ok: true }> {
  const reset = await findValidPasswordReset(hashResetToken(token));
  if (!reset) {
    throw new ValidationError("Reset token is invalid or expired");
  }

  const customer = await findCustomerById(reset.customer_id);
  if (!customer || !customer.is_active) {
    throw new ValidationError("Reset token is invalid or expired");
  }

  const passwordHash = await hashPassword(password);
  await updateCustomerPassword(customer.id, passwordHash);
  await markPasswordResetUsed(reset.id);
  await invalidateCustomerPasswordResets(customer.id);

  return { ok: true };
}

export async function requestOtp(phoneInput: string): Promise<{
  ok: true;
  message: string;
  phone: string;
  devOtp?: string;
}> {
  if (env.NODE_ENV === "production") {
    throw new ValidationError("OTP login is only enabled in development");
  }

  const phone = normalizePhone(phoneInput);
  if (phone.length !== 10) {
    throw new ValidationError("Enter a valid 10-digit phone number");
  }

  // Dev auth system: only the fixed number is accepted.
  if (phone !== DEV_OTP_PHONE) {
    throw new ValidationError("This phone number is not enabled for OTP login");
  }

  await createOtpChallenge(phone, hashOtp(DEV_OTP_CODE), new Date(Date.now() + OTP_TTL_MS));
  console.info(`[dev] OTP for ${phone}: ${DEV_OTP_CODE}`);

  return {
    ok: true,
    message: "OTP sent",
    phone,
    devOtp: DEV_OTP_CODE,
  };
}

export async function verifyOtpLogin(
  req: Request,
  phoneInput: string,
  otpInput: string,
): Promise<CustomerProfile> {
  if (env.NODE_ENV === "production") {
    throw new ValidationError("OTP login is only enabled in development");
  }

  const phone = normalizePhone(phoneInput);
  const otp = otpInput.trim();

  if (phone !== DEV_OTP_PHONE || otp !== DEV_OTP_CODE) {
    throw new UnauthorizedError(INVALID_OTP);
  }

  const challenge = await findValidOtpChallenge(phone, hashOtp(otp));
  if (challenge) {
    await consumeOtpChallenge(challenge.id);
  }

  const customer = await getOrCreatePhoneCustomer(phone);
  return establishCustomerSession(req, customer, req.sessionID);
}
