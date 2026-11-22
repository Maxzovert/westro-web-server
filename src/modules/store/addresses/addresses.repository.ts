import type { PoolClient } from "pg";
import { pool } from "../../../database/connection/pool.js";

type Db = PoolClient | typeof pool;

export type AddressRow = {
  id: string;
  customer_id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  country: string;
  address_type: "shipping" | "billing" | "other";
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

export async function listAddressesByCustomerId(
  customerId: string,
  db: Db = pool,
): Promise<AddressRow[]> {
  const result = await db.query<AddressRow>(
    `SELECT
       id, customer_id, label, line1, line2, city, state, postal_code, country,
       address_type, is_default, created_at, updated_at
     FROM customer_addresses
     WHERE customer_id = $1
     ORDER BY is_default DESC, created_at DESC`,
    [customerId],
  );
  return result.rows;
}

export async function findAddressForCustomer(
  customerId: string,
  addressId: string,
  db: Db = pool,
): Promise<AddressRow | null> {
  const result = await db.query<AddressRow>(
    `SELECT
       id, customer_id, label, line1, line2, city, state, postal_code, country,
       address_type, is_default, created_at, updated_at
     FROM customer_addresses
     WHERE id = $1 AND customer_id = $2`,
    [addressId, customerId],
  );
  return result.rows[0] ?? null;
}

export async function clearDefaultAddresses(
  customerId: string,
  db: Db = pool,
): Promise<void> {
  await db.query(
    `UPDATE customer_addresses
     SET is_default = FALSE, updated_at = now()
     WHERE customer_id = $1 AND is_default = TRUE`,
    [customerId],
  );
}

export async function createAddress(
  customerId: string,
  input: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string;
    addressType: "shipping" | "billing" | "other";
    isDefault: boolean;
  },
  db: Db = pool,
): Promise<AddressRow> {
  if (input.isDefault) {
    await clearDefaultAddresses(customerId, db);
  }

  const result = await db.query<AddressRow>(
    `INSERT INTO customer_addresses (
       customer_id, label, line1, line2, city, state, postal_code, country, address_type, is_default
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING
       id, customer_id, label, line1, line2, city, state, postal_code, country,
       address_type, is_default, created_at, updated_at`,
    [
      customerId,
      input.label,
      input.line1,
      input.line2,
      input.city,
      input.state,
      input.postalCode,
      input.country,
      input.addressType,
      input.isDefault,
    ],
  );
  return result.rows[0];
}

export async function updateAddress(
  customerId: string,
  addressId: string,
  input: {
    label?: string | null;
    line1?: string;
    line2?: string | null;
    city?: string;
    state?: string | null;
    postalCode?: string | null;
    country?: string;
    addressType?: "shipping" | "billing" | "other";
    isDefault?: boolean;
  },
  db: Db = pool,
): Promise<AddressRow | null> {
  if (input.isDefault === true) {
    await clearDefaultAddresses(customerId, db);
  }

  const result = await db.query<AddressRow>(
    `UPDATE customer_addresses
     SET
       label = CASE WHEN $3::boolean THEN $4 ELSE label END,
       line1 = COALESCE($5, line1),
       line2 = CASE WHEN $6::boolean THEN $7 ELSE line2 END,
       city = COALESCE($8, city),
       state = CASE WHEN $9::boolean THEN $10 ELSE state END,
       postal_code = CASE WHEN $11::boolean THEN $12 ELSE postal_code END,
       country = COALESCE($13, country),
       address_type = COALESCE($14, address_type),
       is_default = COALESCE($15, is_default),
       updated_at = now()
     WHERE id = $1 AND customer_id = $2
     RETURNING
       id, customer_id, label, line1, line2, city, state, postal_code, country,
       address_type, is_default, created_at, updated_at`,
    [
      addressId,
      customerId,
      Object.prototype.hasOwnProperty.call(input, "label"),
      input.label ?? null,
      input.line1 ?? null,
      Object.prototype.hasOwnProperty.call(input, "line2"),
      input.line2 ?? null,
      input.city ?? null,
      Object.prototype.hasOwnProperty.call(input, "state"),
      input.state ?? null,
      Object.prototype.hasOwnProperty.call(input, "postalCode"),
      input.postalCode ?? null,
      input.country ?? null,
      input.addressType ?? null,
      input.isDefault ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function deleteAddress(
  customerId: string,
  addressId: string,
  db: Db = pool,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2`,
    [addressId, customerId],
  );
  return (result.rowCount ?? 0) > 0;
}
