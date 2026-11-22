/**
 * Customer session middleware
 * ---------------------------
 * Cookie sessions stored in PostgreSQL (`sessions` table — shared DB with Admin).
 * Cookie name is store-specific so Admin and Website sessions do not collide.
 */
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { env } from "../config/env.js";
import { pool } from "../database/connection/pool.js";

const PgSession = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "sessions",
    createTableIfMissing: false,
  }),
  /** Distinct from Admin's `wastro.sid`. */
  name: "wastro_store.sid",
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: env.SESSION_ABSOLUTE_MS,
  },
});
