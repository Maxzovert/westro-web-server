import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../database/connection/pool.js";

type Db = PoolClient | typeof pool;

export type CustomerAuthRow = {
  id: string;
  name: string;
  email: string | null;
  normalized_email: string | null;
  password_hash: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type PasswordResetRow = {
  id: string;
  customer_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function findCustomerById(
  id: string,
  db: Db = pool,
): Promise<CustomerAuthRow | null> {
  const result = await db.query<CustomerAuthRow>(
    `SELECT id, name, email, normalized_email, password_hash, phone, is_active, created_at, updated_at
     FROM customers
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findCustomerByNormalizedEmail(
  normalizedEmail: string,
  db: Db = pool,
): Promise<CustomerAuthRow | null> {
  const result = await db.query<CustomerAuthRow>(
    `SELECT id, name, email, normalized_email, password_hash, phone, is_active, created_at, updated_at
     FROM customers
     WHERE normalized_email = $1
     LIMIT 1`,
    [normalizedEmail],
  );
  return result.rows[0] ?? null;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

export async function findCustomerByPhone(
  phone: string,
  db: Db = pool,
): Promise<CustomerAuthRow | null> {
  const result = await db.query<CustomerAuthRow>(
    `SELECT id, name, email, normalized_email, password_hash, phone, is_active, created_at, updated_at
     FROM customers
     WHERE phone = $1
     LIMIT 1`,
    [phone],
  );
  return result.rows[0] ?? null;
}

export async function createCustomerAccount(
  input: {
    name: string;
    email: string;
    normalizedEmail: string;
    passwordHash: string;
    phone?: string | null;
  },
  db: Db = pool,
): Promise<CustomerAuthRow> {
  const result = await db.query<CustomerAuthRow>(
    `INSERT INTO customers (name, email, normalized_email, password_hash, phone, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id, name, email, normalized_email, password_hash, phone, is_active, created_at, updated_at`,
    [
      input.name,
      input.email,
      input.normalizedEmail,
      input.passwordHash,
      input.phone ?? null,
    ],
  );
  return result.rows[0];
}

export async function createOtpChallenge(
  phone: string,
  otpHash: string,
  expiresAt: Date,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE customer_otp_challenges
     SET consumed_at = now()
     WHERE phone = $1 AND consumed_at IS NULL`,
    [phone],
  );
  await db.query(
    `INSERT INTO customer_otp_challenges (phone, otp_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [phone, otpHash, expiresAt.toISOString()],
  );
}

export async function findValidOtpChallenge(
  phone: string,
  otpHash: string,
  db: Db = pool,
): Promise<{ id: string } | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM customer_otp_challenges
     WHERE phone = $1
       AND otp_hash = $2
       AND consumed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone, otpHash],
  );
  return result.rows[0] ?? null;
}

export async function consumeOtpChallenge(id: string, db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE customer_otp_challenges
     SET consumed_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function updateCustomerPassword(
  customerId: string,
  passwordHash: string,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE customers
     SET password_hash = $2, updated_at = now()
     WHERE id = $1`,
    [customerId, passwordHash],
  );
}

export async function claimCustomerAccount(
  customerId: string,
  input: {
    name: string;
    email: string;
    normalizedEmail: string;
    passwordHash: string;
  },
  db: Db = pool,
): Promise<CustomerAuthRow> {
  const result = await db.query<CustomerAuthRow>(
    `UPDATE customers
     SET
       name = $2,
       email = $3,
       normalized_email = $4,
       password_hash = $5,
       is_active = TRUE,
       updated_at = now()
     WHERE id = $1
     RETURNING id, name, email, normalized_email, password_hash, phone, is_active, created_at, updated_at`,
    [customerId, input.name, input.email, input.normalizedEmail, input.passwordHash],
  );
  return result.rows[0];
}

export async function createPasswordReset(
  customerId: string,
  tokenHash: string,
  expiresAt: Date,
  db: Db = pool,
): Promise<PasswordResetRow> {
  const result = await db.query<PasswordResetRow>(
    `INSERT INTO customer_password_resets (customer_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, customer_id, token_hash, expires_at, used_at`,
    [customerId, tokenHash, expiresAt.toISOString()],
  );
  return result.rows[0];
}

export async function findValidPasswordReset(
  tokenHash: string,
  db: Db = pool,
): Promise<PasswordResetRow | null> {
  const result = await db.query<PasswordResetRow>(
    `SELECT id, customer_id, token_hash, expires_at, used_at
     FROM customer_password_resets
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function markPasswordResetUsed(
  resetId: string,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE customer_password_resets
     SET used_at = now()
     WHERE id = $1`,
    [resetId],
  );
}

export async function invalidateCustomerPasswordResets(
  customerId: string,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE customer_password_resets
     SET used_at = now()
     WHERE customer_id = $1 AND used_at IS NULL`,
    [customerId],
  );
}
