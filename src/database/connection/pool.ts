/**
 * PostgreSQL connection pool
 * --------------------------
 * Shared with Admin at the database level (same DATABASE_URL).
 * This process only opens its own pool — do not share Pool instances across apps.
 */
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { Pool } from "pg";
import { env } from "../../config/env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

/** Lightweight readiness probe used by `/api/v1/health`. */
export async function checkDatabaseConnection(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}

/**
 * Run work inside a DB transaction.
 * Used later for checkout / stock reservation (always commit/rollback safely).
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Parameterized query helper — prefer this over embedding values in SQL strings. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Close the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
