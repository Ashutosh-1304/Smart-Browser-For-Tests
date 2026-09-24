import knex from 'knex';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import knexConfig from './knexfile.js';

// Ensure data directory exists if using local SQLite file
if (config.databasePath && !config.databasePath.startsWith(':memory:')) {
  const dir = path.dirname(config.databasePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const env = config.nodeEnv === 'production' ? 'production' : 'development';
const activeKnexConfig = { ...knexConfig[env] };

if (config.databasePath) {
  activeKnexConfig.connection = { filename: config.databasePath };
}

export const db = knex(activeKnexConfig);

/**
 * Ensure database schema exists.
 */
export async function initDb() {
  const exists = await db.schema.hasTable('codes');
  if (!exists) {
    await db.schema.createTable('codes', (table) => {
      table.string('id').primary();
      table.string('code', 6).notNullable().unique().index();
      table.text('target_url').notNullable();
      table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
      table.timestamp('expires_at').nullable();
      table.string('status', 20).defaultTo('active').notNullable();
      table.integer('hit_count').defaultTo(0).notNullable();
      table.string('created_by').nullable();
    });
  }
}
