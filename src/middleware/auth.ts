/**
 * Customer session auth
 * ---------------------
 * Protects account routes. Guests remain allowed on catalog/cart.
 */
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { findCustomerById } from "../modules/store/auth/auth.repository.js";
import { UnauthorizedError } from "../shared/errors.js";

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

export async function requireCustomer(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const customerId = req.session.customerId;
    const createdAt = req.session.createdAt;
    const lastSeenAt = req.session.lastSeenAt;

    if (!customerId || !createdAt || !lastSeenAt) {
      throw new UnauthorizedError();
    }

    const now = Date.now();
    if (now - createdAt > env.SESSION_ABSOLUTE_MS) {
      await destroySession(req);
      throw new UnauthorizedError("Session expired");
    }

    if (now - lastSeenAt > env.SESSION_IDLE_MS) {
      await destroySession(req);
      throw new UnauthorizedError("Session expired due to inactivity");
    }

    const customer = await findCustomerById(customerId);
    if (!customer || !customer.is_active || !customer.password_hash) {
      await destroySession(req);
      throw new UnauthorizedError("Account is inactive or not found");
    }

    req.session.lastSeenAt = now;
    req.customer = {
      id: customer.id,
      email: customer.email ?? "",
      name: customer.name,
      isActive: customer.is_active,
    };

    next();
  } catch (error) {
    next(error);
  }
}
