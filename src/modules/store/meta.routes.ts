/**
 * Store meta
 * ----------
 * Public storefront config (currency, support contact, feature flags).
 * Keep this free of Admin-only fields.
 */
import { Router } from "express";
import { pool } from "../../database/connection/pool.js";
import { sendSuccess } from "../../shared/http.js";

export const storeMetaRouter = Router();

async function readMaintenanceMode(): Promise<boolean> {
  try {
    const result = await pool.query<{ maintenance_mode: boolean }>(
      `SELECT maintenance_mode FROM site_settings WHERE id = 1`,
    );
    return result.rows[0]?.maintenance_mode ?? true;
  } catch {
    // Table may not exist until Admin migration is applied — fail closed.
    return true;
  }
}

storeMetaRouter.get("/", async (_req, res, next) => {
  try {
    const maintenanceMode = await readMaintenanceMode();
    sendSuccess(res, {
      storeName: "Wastro",
      apiVersion: "v1",
      currency: "INR",
      supportEmail: "support@wastro.local",
      descriptor: "Medical Apparel | Equipment | More",
      features: {
        guestCheckout: false,
        cod: false,
        maintenanceMode,
      },
    });
  } catch (error) {
    next(error);
  }
});
