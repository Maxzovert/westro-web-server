import { NotFoundError } from "../../../shared/errors.js";
import {
  createAddress,
  deleteAddress,
  findAddressForCustomer,
  listAddressesByCustomerId,
  updateAddress,
  type AddressRow,
} from "./addresses.repository.js";

export type StoreAddressDto = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  addressType: "shipping" | "billing" | "other";
  isDefault: boolean;
};

function toDto(row: AddressRow): StoreAddressDto {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    addressType: row.address_type,
    isDefault: row.is_default,
  };
}

export async function listAddressesService(customerId: string) {
  const rows = await listAddressesByCustomerId(customerId);
  return rows.map(toDto);
}

export async function createAddressService(
  customerId: string,
  input: {
    label?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    state?: string | null;
    postalCode?: string | null;
    country: string;
    addressType: "shipping" | "billing" | "other";
    isDefault: boolean;
  },
) {
  const row = await createAddress(customerId, {
    label: input.label ?? null,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country,
    addressType: input.addressType,
    isDefault: input.isDefault,
  });
  return toDto(row);
}

export async function updateAddressService(
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
) {
  const existing = await findAddressForCustomer(customerId, addressId);
  if (!existing) {
    throw new NotFoundError("Address not found");
  }

  const row = await updateAddress(customerId, addressId, input);
  if (!row) {
    throw new NotFoundError("Address not found");
  }
  return toDto(row);
}

export async function deleteAddressService(customerId: string, addressId: string) {
  const removed = await deleteAddress(customerId, addressId);
  if (!removed) {
    throw new NotFoundError("Address not found");
  }
  return { ok: true as const };
}
