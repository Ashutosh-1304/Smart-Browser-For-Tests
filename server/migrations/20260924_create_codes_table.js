/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  const exists = await knex.schema.hasTable('codes');
  if (!exists) {
    await knex.schema.createTable('codes', (table) => {
      table.string('id').primary();
      table.string('code', 6).notNullable().unique().index();
      table.text('target_url').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
      table.timestamp('expires_at').nullable();
      table.string('status', 20).defaultTo('active').notNullable();
      table.integer('hit_count').defaultTo(0).notNullable();
      table.string('created_by').nullable();
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('codes');
}
