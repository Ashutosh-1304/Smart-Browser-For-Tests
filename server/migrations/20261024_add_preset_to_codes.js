export async function up(knex) {
  const hasPresetId = await knex.schema.hasColumn('codes', 'preset_id');
  if (!hasPresetId) {
    await knex.schema.alterTable('codes', (table) => {
      table.string('preset_id', 20).notNullable().defaultTo('level-2');
      table.text('preset_config').nullable();
    });
  }
}

export async function down(knex) {
  const hasPresetId = await knex.schema.hasColumn('codes', 'preset_id');
  if (hasPresetId) {
    await knex.schema.alterTable('codes', (table) => {
      table.dropColumn('preset_id');
      table.dropColumn('preset_config');
    });
  }
}
