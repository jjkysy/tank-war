import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "./env";

// One pool per process. `max` is deliberately small: the app runs as a single
// container and Cloud Run scales by adding instances, not connections.
const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export const db = drizzle(pool);
