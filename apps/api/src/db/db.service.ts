/**
 * DbService — the single Drizzle handle for the API [D-37].
 *
 * Wraps a `pg` Pool and exposes:
 * - `db`: the typed Drizzle database (`db.query.*`, `db.select()` ...).
 * - `withOrgScope(orgId, fn)`: a transaction with the row-level-security
 *   tenant setting `app.current_org_id` applied (defense in depth, D-19).
 * - `ping()`: connectivity probe for the health indicator.
 *
 * Repositories under `./repositories` build on this service; application
 * services depend on repositories so that unit tests mock plain methods.
 */
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgTransaction } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Transaction = NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;
/** Either the root database or a transaction: what repositories accept. */
export type DbExecutor = Database | Transaction;

/** Create a Drizzle database over a pool; shared by the API, scripts and tests. */
export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/** Session setting read by the tenant-isolation RLS policies. */
export const TENANT_SETTING = 'app.current_org_id';

/**
 * Run `fn` inside a transaction whose RLS tenant setting is `orgId`.
 * Standalone so that scripts and tests can use it without NestJS.
 */
export async function withOrgScope<T>(
  db: Database,
  orgId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${orgId}, true)`);
    return fn(tx);
  });
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool: Pool;
  readonly db: Database;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }
    this.pool = new Pool({
      connectionString,
      max: configService.get<number>('DATABASE_POOL_MAX', 10),
      application_name: 'nestself-api',
    });
    this.pool.on('error', (err) => {
      this.logger.error(err, 'Idle PostgreSQL client error');
    });
    this.db = createDatabase(this.pool);
  }

  /** Fail fast when the database is unreachable at start-up. */
  async onModuleInit(): Promise<void> {
    await this.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Round-trip probe used by the health check. Throws on failure. */
  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  /** Transaction scoped to one organization through RLS [D-19, D-37]. */
  withOrgScope<T>(orgId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withOrgScope(this.db, orgId, fn);
  }
}
