// Adds proctoring strictness preset columns to `codes` (issue #22).
// `preset_id` is the selected level ('level-1' | 'level-2' | 'level-3' | 'custom').
// `preset_config` stores the fully-resolved preset JSON so every student who
// joins a code is proctored under the exact same standard, and so the config is
// auditable with the session results later.
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
