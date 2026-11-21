export async function up(knex) {
  const hasPlatform = await knex.schema.hasColumn('codes', 'platform_type');
  if (!hasPlatform) {
    await knex.schema.alterTable('codes', (table) => {
      table.string('platform_type', 50).notNullable().defaultTo('google-forms');
      table.float('max_score').notNullable().defaultTo(100);
      table.string('normalization_rule', 50).notNullable().defaultTo('multiplier');
    });
  }

  const sessionsExists = await knex.schema.hasTable('sessions');
  if (!sessionsExists) {
    await knex.schema.createTable('sessions', (table) => {
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
      table.timestamp('submitted_at').defaultTo(knex.fn.now()).notNullable();
      table.integer('duration_seconds').defaultTo(0).notNullable();
      table.integer('violations_count').defaultTo(0).notNullable();
      table.text('violations_summary').nullable();
      table.text('url_logs').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sessions');
  const hasPlatform = await knex.schema.hasColumn('codes', 'platform_type');
  if (hasPlatform) {
    await knex.schema.alterTable('codes', (table) => {
      table.dropColumn('platform_type');
      table.dropColumn('max_score');
      table.dropColumn('normalization_rule');
    });
  }
}
