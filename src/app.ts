/**
 * Express application factory
 * ---------------------------
 * Wires middleware + storefront routes. No Admin/staff routes live here.
 */
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { sessionMiddleware } from "./middleware/session.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { storeAddressesRouter } from "./modules/store/addresses/addresses.routes.js";
import { storeAuthRouter } from "./modules/store/auth/auth.routes.js";
import { storeCartRouter } from "./modules/store/cart/cart.routes.js";
import { storeCategoriesRouter } from "./modules/store/categories/categories.routes.js";
import { storeCheckoutRouter } from "./modules/store/checkout/checkout.routes.js";
import { storeMetaRouter } from "./modules/store/meta.routes.js";
import { storeOrdersRouter } from "./modules/store/orders/orders.routes.js";
import {
  storePaymentWebhooksRouter,
  storePaymentsRouter,
} from "./modules/store/payments/payments.routes.js";
import { storeProductsRouter } from "./modules/store/products/products.routes.js";
import { storeShippingRouter } from "./modules/store/shipping/shipping.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(sessionMiddleware);
  app.use(cookieParser());

  app.get("/", (_req, res) => {
    res.json({
      name: "wastro-website-server",
      version: "0.6.0",
      docs: [
        "/api/v1/health",
        "/api/v1/store/meta",
        "/api/v1/store/auth/csrf",
        "/api/v1/store/categories",
        "/api/v1/store/products",
        "/api/v1/store/cart",
        "/api/v1/store/addresses",
        "/api/v1/store/shipping/options",
        "/api/v1/store/checkout/quote",
        "/api/v1/store/checkout/place-order",
        "/api/v1/store/orders",
        "/api/v1/store/payments/create",
        "/api/v1/store/webhooks/payments/:provider",
      ],
    });
  });

  // --- Public / storefront API surface ---
  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/store/meta", storeMetaRouter);
  app.use("/api/v1/store/auth", storeAuthRouter);
  app.use("/api/v1/store/categories", storeCategoriesRouter);
  app.use("/api/v1/store/products", storeProductsRouter);
  app.use("/api/v1/store/cart", storeCartRouter);
  app.use("/api/v1/store/addresses", storeAddressesRouter);
  app.use("/api/v1/store/shipping", storeShippingRouter);
  app.use("/api/v1/store/checkout", storeCheckoutRouter);
  app.use("/api/v1/store/orders", storeOrdersRouter);
  app.use("/api/v1/store/payments", storePaymentsRouter);
  app.use("/api/v1/store/webhooks/payments", storePaymentWebhooksRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
