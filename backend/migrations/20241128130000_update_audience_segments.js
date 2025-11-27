exports.up = async function (knex) {
  await knex.schema.alterTable('audience_segments', (table) => {
    table
      .uuid('source_parsing_id')
      .references('id')
      .inTable('parsing_history')
      .onDelete('SET NULL');
    table.integer('total_recipients').notNullable().defaultTo(0);
    table.string('status', 32).notNullable().defaultTo('ready');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('audience_segments', (table) => {
    table.dropColumn('status');
    table.dropColumn('total_recipients');
    table.dropColumn('source_parsing_id');
  });
};
