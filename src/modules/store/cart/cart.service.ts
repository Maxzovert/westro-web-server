import { AppError, NotFoundError, ValidationError } from "../../../shared/errors.js";
import { withTransaction } from "../../../database/connection/pool.js";
import {
  clearCartItems,
  createCart,
  deleteCart,
  deleteCartItem,
  findCartByCustomerId,
  findCartItem,
  findCartItemByVariant,
  findGuestCartBySessionId,
  findSellableVariant,
  listCartItemDetails,
  updateCartItemQuantity,
  upsertCartItemQuantity,
  type CartItemDetailRow,
  type CartRow,
} from "./cart.repository.js";

export type CartOwner = {
  customerId?: string;
  sessionId: string;
};

export type StoreCartItemDto = {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  sku: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  imageUrl: string | null;
  available: number;
  sellable: boolean;
};

export type StoreCartDto = {
  id: string | null;
  currency: string;
  items: StoreCartItemDto[];
  itemCount: number;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string;
};

function formatMoney(value: number | string): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

function emptyCart(currency = "INR"): StoreCartDto {
  return {
    id: null,
    currency,
    items: [],
    itemCount: 0,
    subtotal: "0.00",
    discountTotal: "0.00",
    shippingTotal: "0.00",
    taxTotal: "0.00",
    grandTotal: "0.00",
  };
}

function mapItem(row: CartItemDetailRow): StoreCartItemDto {
  const unitPrice = Number(row.unit_price);
  const lineTotal = unitPrice * row.quantity;
  const sellable = row.product_status === "active" && row.available > 0;

  return {
    id: row.id,
    variantId: row.variant_id,
    productId: row.product_id,
    productSlug: row.product_slug,
    name: row.product_name,
    sku: row.sku,
    unitPrice: formatMoney(unitPrice),
    quantity: row.quantity,
    lineTotal: formatMoney(lineTotal),
    imageUrl: row.image_url,
    available: row.available,
    sellable,
  };
}

function toCartDto(cart: CartRow, rows: CartItemDetailRow[]): StoreCartDto {
  const items = rows.map(mapItem);
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0);

  return {
    id: cart.id,
    currency: cart.currency,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: formatMoney(subtotal),
    discountTotal: "0.00",
    shippingTotal: "0.00",
    taxTotal: "0.00",
    grandTotal: formatMoney(subtotal),
  };
}

async function findOwnerCart(owner: CartOwner): Promise<CartRow | null> {
  if (owner.customerId) {
    return findCartByCustomerId(owner.customerId);
  }
  return findGuestCartBySessionId(owner.sessionId);
}

async function getOrCreateCart(owner: CartOwner): Promise<CartRow> {
  const existing = await findOwnerCart(owner);
  if (existing) return existing;

  return createCart({
    customerId: owner.customerId ?? null,
    sessionId: owner.customerId ? null : owner.sessionId,
  });
}

async function loadCartDto(cart: CartRow): Promise<StoreCartDto> {
  const rows = await listCartItemDetails(cart.id);
  return toCartDto(cart, rows);
}

function assertStock(available: number, requested: number) {
  if (requested > available) {
    throw new AppError("Requested quantity exceeds available stock", {
      statusCode: 400,
      code: "INSUFFICIENT_STOCK",
      details: { available, requested },
    });
  }
}

export async function getCartService(owner: CartOwner): Promise<StoreCartDto> {
  const cart = await findOwnerCart(owner);
  if (!cart) return emptyCart();
  return loadCartDto(cart);
}

export async function addCartItemService(
  owner: CartOwner,
  input: { variantId: string; quantity: number },
): Promise<StoreCartDto> {
  const variant = await findSellableVariant(input.variantId);
  if (!variant || variant.product_status !== "active") {
    throw new ValidationError("Variant is not available for purchase");
  }

  const cart = await getOrCreateCart(owner);
  const existing = await findCartItemByVariant(cart.id, input.variantId);
  const nextQty = (existing?.quantity ?? 0) + input.quantity;

  assertStock(variant.available, nextQty);
  await upsertCartItemQuantity(cart.id, input.variantId, nextQty);
  return loadCartDto(cart);
}

export async function updateCartItemService(
  owner: CartOwner,
  itemId: string,
  quantity: number,
): Promise<StoreCartDto> {
  const cart = await findOwnerCart(owner);
  if (!cart) {
    throw new NotFoundError("Cart item not found");
  }

  const item = await findCartItem(cart.id, itemId);
  if (!item) {
    throw new NotFoundError("Cart item not found");
  }

  const variant = await findSellableVariant(item.variant_id);
  if (!variant || variant.product_status !== "active") {
    throw new ValidationError("Variant is not available for purchase");
  }

  assertStock(variant.available, quantity);
  await updateCartItemQuantity(cart.id, itemId, quantity);
  return loadCartDto(cart);
}

export async function removeCartItemService(
  owner: CartOwner,
  itemId: string,
): Promise<StoreCartDto> {
  const cart = await findOwnerCart(owner);
  if (!cart) {
    throw new NotFoundError("Cart item not found");
  }

  const removed = await deleteCartItem(cart.id, itemId);
  if (!removed) {
    throw new NotFoundError("Cart item not found");
  }

  return loadCartDto(cart);
}

export async function clearCartService(owner: CartOwner): Promise<StoreCartDto> {
  const cart = await findOwnerCart(owner);
  if (!cart) return emptyCart();

  await clearCartItems(cart.id);
  // Drop empty guest carts so sessions do not accumulate orphan rows.
  if (!owner.customerId) {
    await deleteCart(cart.id);
    return emptyCart();
  }

  return loadCartDto(cart);
}

/**
 * After login/register, move guest session cart lines into the customer cart.
 * Quantities are merged and clamped to available stock.
 */
export async function mergeGuestCartIntoCustomer(
  guestSessionId: string,
  customerId: string,
): Promise<void> {
  if (!guestSessionId || !customerId) return;

  const guestCart = await findGuestCartBySessionId(guestSessionId);
  if (!guestCart) return;

  await withTransaction(async (client) => {
    let customerCart = await findCartByCustomerId(customerId, client);
    if (!customerCart) {
      customerCart = await createCart({ customerId, sessionId: null }, client);
    }

    const guestItems = await listCartItemDetails(guestCart.id, client);
    for (const item of guestItems) {
      if (item.product_status !== "active") continue;

      const existing = await findCartItemByVariant(customerCart.id, item.variant_id, client);
      const mergedQty = Math.min(
        (existing?.quantity ?? 0) + item.quantity,
        Math.max(item.available, 0),
      );
      if (mergedQty < 1) continue;

      await upsertCartItemQuantity(customerCart.id, item.variant_id, mergedQty, client);
    }

    await deleteCart(guestCart.id, client);
  });
}
