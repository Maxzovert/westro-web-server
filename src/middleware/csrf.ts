/**
 * CSRF protection (double-submit cookie pattern)
 * ----------------------------------------------
 * Required for cookie-authenticated state-changing requests.
 * Clients must send header `x-csrf-token` after calling `/api/v1/store/auth/csrf`.
 */
import { doubleCsrf } from "csrf-csrf";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ForbiddenError } from "../shared/errors.js";

const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  getSessionIdentifier: (req) => req.sessionID ?? "",
  // Avoid dots in cookie names — some browsers/parsers mishandle them.
  cookieName: "wastro_store_csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
  },
  getCsrfTokenFromRequest: (req: Request) => {
    const header = req.headers["x-csrf-token"];
    return typeof header === "string" ? header : null;
  },
});

/** Issue (or rotate) a CSRF token bound to the current session. */
export function issueCsrfToken(req: Request, res: Response): string {
  return generateCsrfToken(req, res, { overwrite: true });
}

/** Express middleware — reject mutating requests with a missing/invalid token. */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  doubleCsrfProtection(req, res, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error === invalidCsrfTokenError) {
      next(new ForbiddenError("Invalid CSRF token"));
      return;
    }

    next(error);
  });
}
