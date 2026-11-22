/**
 * Store customer auth
 * -------------------
 * CSRF bootstrap + register/login/logout/me + password reset.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireCustomer } from "../../../middleware/auth.js";
import { csrfProtection, issueCsrfToken } from "../../../middleware/csrf.js";
import { validateRequest } from "../../../middleware/validate.js";
import { sendSuccess } from "../../../shared/http.js";
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  otpRequestBodySchema,
  otpVerifyBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
} from "./auth.schemas.js";
import {
  forgotPassword,
  getCustomerProfile,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  requestOtp,
  resetPassword,
  verifyOtpLogin,
} from "./auth.service.js";

export const storeAuthRouter = Router();

function authLimiter(message: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message,
        },
        requestId: req.requestId,
      });
    },
  });
}

const registerLimiter = authLimiter("Too many registration attempts. Try again later.");
const loginLimiter = authLimiter("Too many login attempts. Try again later.");
const resetLimiter = authLimiter("Too many password reset attempts. Try again later.");
const otpLimiter = authLimiter("Too many OTP attempts. Try again later.");

/**
 * GET /api/v1/store/auth/csrf
 * Touch the session so an anonymous session id exists, then issue a CSRF token.
 */
storeAuthRouter.get("/csrf", (req, res, next) => {
  req.session.csrfIssuedAt = Date.now();
  req.session.save((error) => {
    if (error) {
      next(error);
      return;
    }
    const csrfToken = issueCsrfToken(req, res);
    sendSuccess(res, { csrfToken });
  });
});

storeAuthRouter.post(
  "/register",
  registerLimiter,
  csrfProtection,
  validateRequest({ body: registerBodySchema }),
  async (req, res, next) => {
    try {
      const user = await registerCustomer(req, req.body);
      const csrfToken = issueCsrfToken(req, res);
      sendSuccess(res, { user, csrfToken }, { statusCode: 201 });
    } catch (error) {
      next(error);
    }
  },
);

storeAuthRouter.post(
  "/login",
  loginLimiter,
  csrfProtection,
  validateRequest({ body: loginBodySchema }),
  async (req, res, next) => {
    try {
      const user = await loginCustomer(req, req.body.email, req.body.password);
      const csrfToken = issueCsrfToken(req, res);
      sendSuccess(res, { user, csrfToken });
    } catch (error) {
      next(error);
    }
  },
);

storeAuthRouter.post("/logout", requireCustomer, csrfProtection, async (req, res, next) => {
  try {
    await logoutCustomer(req);
    res.clearCookie("wastro_store.sid");
    sendSuccess(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

storeAuthRouter.get("/me", requireCustomer, async (req, res, next) => {
  try {
    const user = await getCustomerProfile(req.customer!.id);
    sendSuccess(res, { user });
  } catch (error) {
    next(error);
  }
});

storeAuthRouter.post(
  "/forgot-password",
  resetLimiter,
  csrfProtection,
  validateRequest({ body: forgotPasswordBodySchema }),
  async (req, res, next) => {
    try {
      const result = await forgotPassword(req.body.email);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);

storeAuthRouter.post(
  "/reset-password",
  resetLimiter,
  csrfProtection,
  validateRequest({ body: resetPasswordBodySchema }),
  async (req, res, next) => {
    try {
      const result = await resetPassword(req.body.token, req.body.password);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);

storeAuthRouter.post(
  "/otp/request",
  otpLimiter,
  csrfProtection,
  validateRequest({ body: otpRequestBodySchema }),
  async (req, res, next) => {
    try {
      const result = await requestOtp(req.body.phone);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);

storeAuthRouter.post(
  "/otp/verify",
  otpLimiter,
  csrfProtection,
  validateRequest({ body: otpVerifyBodySchema }),
  async (req, res, next) => {
    try {
      const user = await verifyOtpLogin(req, req.body.phone, req.body.otp);
      const csrfToken = issueCsrfToken(req, res);
      sendSuccess(res, { user, csrfToken });
    } catch (error) {
      next(error);
    }
  },
);
