/**
 * Express type augmentation
 * -------------------------
 * Adds requestId and customer session fields used across middleware/routes.
 */
import "express-serve-static-core";
import "express-session";

export type StoreCustomer = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
};

declare module "express-serve-static-core" {
  interface Request {
    /** Correlation id from `requestIdMiddleware` (also returned on errors). */
    requestId: string;
    /** Populated later by customer auth middleware (Phase 04). */
    customer?: StoreCustomer;
  }
}

declare module "express-session" {
  interface SessionData {
    /** Customer user id when logged in (Phase 04). */
    customerId?: string;
    createdAt?: number;
    lastSeenAt?: number;
    /** Set when CSRF was issued so anonymous sessions persist. */
    csrfIssuedAt?: number;
  }
}
