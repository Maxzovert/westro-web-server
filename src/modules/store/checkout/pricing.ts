import { ValidationError } from "../../../shared/errors.js";
import { findShippingMethod } from "../shipping/shipping.catalog.js";

export type PricedLine = {
  variantId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type QuoteTotals = {
  currency: string;
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  shippingMethodId: string;
  couponCode: string | null;
};

export function formatMoney(value: number): string {
  return value.toFixed(2);
}

export function applyCoupon(subtotal: number, couponCode: string | null | undefined): {
  discountTotal: number;
  couponCode: string | null;
} {
  if (!couponCode) {
    return { discountTotal: 0, couponCode: null };
  }

  const normalized = couponCode.trim().toUpperCase();
  if (normalized === "WELCOME10") {
    return {
      discountTotal: Number((subtotal * 0.1).toFixed(2)),
      couponCode: normalized,
    };
  }

  throw new ValidationError("Coupon code is invalid", { couponCode });
}

export function buildQuote(input: {
  currency: string;
  lines: PricedLine[];
  shippingMethodId: string;
  couponCode?: string | null;
}): QuoteTotals {
  if (input.lines.length === 0) {
    throw new ValidationError("Cart is empty");
  }

  const shipping = findShippingMethod(input.shippingMethodId);
  if (!shipping) {
    throw new ValidationError("Shipping method is invalid");
  }

  const subtotal = Number(
    input.lines.reduce((sum, line) => sum + line.lineTotal, 0).toFixed(2),
  );
  const { discountTotal, couponCode } = applyCoupon(subtotal, input.couponCode);
  const shippingTotal = shipping.amount;
  const taxTotal = 0;
  const grandTotal = Number(
    Math.max(subtotal - discountTotal + shippingTotal + taxTotal, 0).toFixed(2),
  );

  return {
    currency: input.currency,
    lines: input.lines,
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal,
    grandTotal,
    shippingMethodId: shipping.id,
    couponCode,
  };
}
