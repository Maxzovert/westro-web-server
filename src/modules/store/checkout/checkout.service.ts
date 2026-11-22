import type { PoolClient } from "pg";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../../../shared/errors.js";
import { withTransaction } from "../../../database/connection/pool.js";
import { findAddressForCustomer } from "../addresses/addresses.repository.js";
import {
  clearCartItems,
  findCartByCustomerId,
  listCartItemDetails,
} from "../cart/cart.repository.js";
import { listShippingMethods } from "../shipping/shipping.catalog.js";
import {
  createOrder,
  createOrderNumber,
  findIdempotencyRecord,
  findLatestPaymentStatus,
  findOrderForCustomer,
  findShipmentSummary,
  hashRequestPayload,
  insertInventoryMovement,
  insertOrderItem,
  insertOrderStatusHistory,
  listOrderItems,
  listOrdersByCustomer,
  lockInventoryLevelsForVariant,
  saveIdempotencyRecord,
  updateInventoryOnHand,
  type OrderItemRow,
  type OrderRow,
} from "./checkout.repository.js";
import { buildQuote, formatMoney, type PricedLine, type QuoteTotals } from "./pricing.js";

export type CheckoutQuoteDto = {
  currency: string;
  lines: Array<{
    variantId: string;
    sku: string;
    name: string;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }>;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string;
  shippingMethodId: string;
  couponCode: string | null;
};

export type PlaceOrderResultDto = {
  orderId: string;
  orderNumber: string;
  status: string;
  currency: string;
  payableAmount: string;
  paymentRequired: boolean;
  totals: {
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    taxTotal: string;
    grandTotal: string;
  };
};

export type StoreOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalAmount: string;
  placedAt: string;
  itemCount: number;
};

export type StoreOrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string;
  shippingMethodId: string | null;
  customerNote: string | null;
  couponCode: string | null;
  shippingAddress: Record<string, unknown> | null;
  placedAt: string;
  items: Array<{
    id: string;
    variantId: string | null;
    sku: string;
    name: string;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }>;
  paymentStatus: string | null;
  shipment: { trackingNumber: string | null; status: string } | null;
};

function moneyDto(quote: QuoteTotals): CheckoutQuoteDto {
  return {
    currency: quote.currency,
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      name: line.name,
      unitPrice: formatMoney(line.unitPrice),
      quantity: line.quantity,
      lineTotal: formatMoney(line.lineTotal),
    })),
    subtotal: formatMoney(quote.subtotal),
    discountTotal: formatMoney(quote.discountTotal),
    shippingTotal: formatMoney(quote.shippingTotal),
    taxTotal: formatMoney(quote.taxTotal),
    grandTotal: formatMoney(quote.grandTotal),
    shippingMethodId: quote.shippingMethodId,
    couponCode: quote.couponCode,
  };
}

async function loadPricedCartLines(customerId: string): Promise<{
  cartId: string;
  currency: string;
  lines: PricedLine[];
}> {
  const cart = await findCartByCustomerId(customerId);
  if (!cart) {
    throw new ValidationError("Cart is empty");
  }

  const rows = await listCartItemDetails(cart.id);
  if (rows.length === 0) {
    throw new ValidationError("Cart is empty");
  }

  const lines: PricedLine[] = [];
  for (const row of rows) {
    if (row.product_status !== "active") {
      throw new ValidationError("Cart contains unavailable products", { sku: row.sku });
    }
    if (row.quantity > row.available) {
      throw new AppError("Requested quantity exceeds available stock", {
        statusCode: 400,
        code: "INSUFFICIENT_STOCK",
        details: { sku: row.sku, available: row.available, requested: row.quantity },
      });
    }
    const unitPrice = Number(row.unit_price);
    lines.push({
      variantId: row.variant_id,
      sku: row.sku,
      name: row.product_name,
      unitPrice,
      quantity: row.quantity,
      lineTotal: Number((unitPrice * row.quantity).toFixed(2)),
    });
  }

  return { cartId: cart.id, currency: cart.currency, lines };
}

async function assertOwnedAddress(customerId: string, addressId: string) {
  const address = await findAddressForCustomer(customerId, addressId);
  if (!address) {
    throw new NotFoundError("Address not found");
  }
  return address;
}

export async function getShippingOptionsService(customerId: string, addressId?: string) {
  if (addressId) {
    await assertOwnedAddress(customerId, addressId);
  }

  return listShippingMethods().map((method) => ({
    id: method.id,
    name: method.name,
    description: method.description,
    amount: formatMoney(method.amount),
    currency: method.currency,
    estimatedDaysMin: method.estimatedDaysMin,
    estimatedDaysMax: method.estimatedDaysMax,
  }));
}

export async function quoteCheckoutService(
  customerId: string,
  input: {
    addressId: string;
    shippingMethodId: string;
    couponCode?: string | null;
  },
): Promise<CheckoutQuoteDto> {
  await assertOwnedAddress(customerId, input.addressId);
  const cart = await loadPricedCartLines(customerId);
  const quote = buildQuote({
    currency: cart.currency,
    lines: cart.lines,
    shippingMethodId: input.shippingMethodId,
    couponCode: input.couponCode,
  });
  return moneyDto(quote);
}

async function deductStockForLine(
  line: PricedLine,
  orderId: string,
  client: PoolClient,
) {
  const levels = await lockInventoryLevelsForVariant(line.variantId, client);
  let remaining = line.quantity;

  for (const level of levels) {
    if (remaining <= 0) break;
    const available = level.quantity_on_hand - level.quantity_reserved;
    const take = Math.min(available, remaining);
    if (take <= 0) continue;

    await updateInventoryOnHand(
      {
        variantId: level.variant_id,
        locationId: level.location_id,
        quantityOnHand: level.quantity_on_hand - take,
        quantityReserved: level.quantity_reserved,
      },
      client,
    );
    await insertInventoryMovement(
      {
        variantId: level.variant_id,
        locationId: level.location_id,
        delta: -take,
        reason: "order_placed",
        referenceId: orderId,
      },
      client,
    );
    remaining -= take;
  }

  if (remaining > 0) {
    throw new AppError("Requested quantity exceeds available stock", {
      statusCode: 400,
      code: "INSUFFICIENT_STOCK",
      details: { sku: line.sku, requested: line.quantity },
    });
  }
}

function mapOrderListItem(order: OrderRow, itemCount: number): StoreOrderListItem {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    currency: order.currency,
    totalAmount: Number(order.total_amount).toFixed(2),
    placedAt: order.placed_at.toISOString(),
    itemCount,
  };
}

function mapOrderDetail(
  order: OrderRow,
  items: OrderItemRow[],
  paymentStatus: string | null,
  shipment: { trackingNumber: string | null; status: string } | null,
): StoreOrderDetail {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    currency: order.currency,
    subtotal: Number(order.subtotal_amount).toFixed(2),
    discountTotal: Number(order.discount_amount).toFixed(2),
    shippingTotal: Number(order.shipping_amount).toFixed(2),
    taxTotal: Number(order.tax_amount).toFixed(2),
    grandTotal: Number(order.total_amount).toFixed(2),
    shippingMethodId: order.shipping_method_id,
    customerNote: order.customer_note,
    couponCode: order.coupon_code,
    shippingAddress: order.shipping_address_snapshot,
    placedAt: order.placed_at.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      variantId: item.variant_id,
      sku: item.sku_snapshot,
      name: item.name_snapshot,
      unitPrice: Number(item.unit_price).toFixed(2),
      quantity: item.quantity,
      lineTotal: Number(item.line_total).toFixed(2),
    })),
    paymentStatus,
    shipment,
  };
}

export async function placeOrderService(
  customerId: string,
  input: {
    addressId: string;
    shippingMethodId: string;
    couponCode?: string | null;
    customerNote?: string | null;
  },
  idempotencyKey: string,
): Promise<{ statusCode: number; body: { data: PlaceOrderResultDto } }> {
  const requestHash = hashRequestPayload(input);
  const existing = await findIdempotencyRecord(customerId, "place-order", idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ConflictError("Idempotency key was reused with a different payload");
    }
    return {
      statusCode: existing.response_status,
      body: existing.response_body as { data: PlaceOrderResultDto },
    };
  }

  const address = await assertOwnedAddress(customerId, input.addressId);
  const cart = await loadPricedCartLines(customerId);
  const quote = buildQuote({
    currency: cart.currency,
    lines: cart.lines,
    shippingMethodId: input.shippingMethodId,
    couponCode: input.couponCode,
  });

  const result = await withTransaction(async (client) => {
    // Re-check stock under locks inside the transaction.
    for (const line of quote.lines) {
      const levels = await lockInventoryLevelsForVariant(line.variantId, client);
      const available = levels.reduce(
        (sum, level) => sum + Math.max(level.quantity_on_hand - level.quantity_reserved, 0),
        0,
      );
      if (available < line.quantity) {
        throw new AppError("Requested quantity exceeds available stock", {
          statusCode: 400,
          code: "INSUFFICIENT_STOCK",
          details: { sku: line.sku, available, requested: line.quantity },
        });
      }
    }

    const order = await createOrder(
      {
        orderNumber: createOrderNumber(),
        customerId,
        currency: quote.currency,
        subtotal: quote.subtotal,
        discount: quote.discountTotal,
        tax: quote.taxTotal,
        shipping: quote.shippingTotal,
        total: quote.grandTotal,
        shippingMethodId: quote.shippingMethodId,
        customerNote: input.customerNote ?? null,
        shippingAddressSnapshot: {
          label: address.label,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postalCode: address.postal_code,
          country: address.country,
          addressType: address.address_type,
        },
        couponCode: quote.couponCode,
      },
      client,
    );

    for (const line of quote.lines) {
      await insertOrderItem(
        {
          orderId: order.id,
          variantId: line.variantId,
          sku: line.sku,
          name: line.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        },
        client,
      );
      await deductStockForLine(line, order.id, client);
    }

    await insertOrderStatusHistory(
      {
        orderId: order.id,
        fromStatus: null,
        toStatus: "pending",
        note: "Order placed from storefront checkout",
      },
      client,
    );

    await clearCartItems(cart.cartId, client);

    const payload: PlaceOrderResultDto = {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      currency: order.currency,
      payableAmount: formatMoney(quote.grandTotal),
      paymentRequired: true,
      totals: {
        subtotal: formatMoney(quote.subtotal),
        discountTotal: formatMoney(quote.discountTotal),
        shippingTotal: formatMoney(quote.shippingTotal),
        taxTotal: formatMoney(quote.taxTotal),
        grandTotal: formatMoney(quote.grandTotal),
      },
    };

    const body = { data: payload };
    await saveIdempotencyRecord(
      {
        customerId,
        scope: "place-order",
        key: idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: body,
      },
      client,
    );

    return { statusCode: 201, body };
  });

  return result;
}

export async function listOrdersService(
  customerId: string,
  input: { page: number; pageSize: number },
) {
  const { rows, total } = await listOrdersByCustomer(
    customerId,
    input.pageSize,
    (input.page - 1) * input.pageSize,
  );

  const items: StoreOrderListItem[] = [];
  for (const order of rows) {
    const orderItems = await listOrderItems(order.id);
    items.push(mapOrderListItem(order, orderItems.reduce((sum, item) => sum + item.quantity, 0)));
  }

  return { items, total };
}

export async function getOrderService(customerId: string, orderId: string) {
  const order = await findOrderForCustomer(customerId, orderId);
  if (!order) {
    throw new NotFoundError("Order not found");
  }

  const [items, payment, shipment] = await Promise.all([
    listOrderItems(order.id),
    findLatestPaymentStatus(order.id),
    findShipmentSummary(order.id),
  ]);

  return mapOrderDetail(order, items, payment?.status ?? null, shipment);
}
