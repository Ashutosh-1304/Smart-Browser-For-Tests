import knex from 'knex';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import knexConfig from './knexfile.js';

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
      table.string('preset_id', 20).defaultTo('level-2').notNullable();
      table.text('preset_config').nullable();
      table.string('platform_type', 50).defaultTo('google-forms').notNullable();
      table.float('max_score').defaultTo(100).notNullable();
      table.string('normalization_rule', 50).defaultTo('multiplier').notNullable();
    });
  } else {
    const hasPreset = await db.schema.hasColumn('codes', 'preset_id');
    if (!hasPreset) {
      await db.schema.alterTable('codes', (table) => {
        table.string('preset_id', 20).defaultTo('level-2').notNullable();
        table.text('preset_config').nullable();
      });
    }
    const hasPlatform = await db.schema.hasColumn('codes', 'platform_type');
    if (!hasPlatform) {
      await db.schema.alterTable('codes', (table) => {
        table.string('platform_type', 50).defaultTo('google-forms').notNullable();
        table.float('max_score').defaultTo(100).notNullable();
        table.string('normalization_rule', 50).defaultTo('multiplier').notNullable();
      });
    }
  }

  const sessionsExists = await db.schema.hasTable('sessions');
  if (!sessionsExists) {
    await db.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.string('code', 6).notNullable().index();
      table.string('student_name', 150).notNullable();
      table.string('student_id', 100).nullable();
      table.string('student_email', 150).nullable();
      table.float('raw_score').nullable();
      table.float('max_score').defaultTo(100).notNullable();
      table.float('fairness_score').notNullable();
      table.float('normalized_score').notNullable();
      table.string('status', 20).defaultTo('passed').notNullable();
      table.timestamp('started_at').nullable();
      table.timestamp('submitted_at').defaultTo(db.fn.now()).notNullable();
      table.integer('duration_seconds').defaultTo(0).notNullable();
      table.integer('violations_count').defaultTo(0).notNullable();
      table.text('violations_summary').nullable();
      table.text('url_logs').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
    });
  }
}
