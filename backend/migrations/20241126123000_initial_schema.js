exports.up = async function (knex) {
  const jsonbObject = () => knex.raw("'{}'::jsonb");
  const jsonbArray = () => knex.raw("'[]'::jsonb");

  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).unique();
    table.string('phone_number', 32);
    table.bigInteger('telegram_id');
    table.string('telegram_username', 64);
    table.string('full_name', 255);
    table.string('password_hash', 255);
    table.string('status', 32).notNullable().defaultTo('active');
    table.jsonb('profile').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['phone_number', 'telegram_id'], 'idx_users_phone_number_telegram_id');
  });

  await knex.schema.createTable('subscriptions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('plan_code', 64).notNullable();
    table.string('plan_name', 128).notNullable();
    table.string('status', 32).notNullable().defaultTo('active');
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.jsonb('metadata').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'expires_at'], 'idx_subscriptions_user_expires_at');
  });

  await knex.schema.createTable('usage_limits', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('limit_key', 64).notNullable();
    table.integer('limit_value').notNullable().defaultTo(0);
    table.integer('consumed_value').notNullable().defaultTo(0);
    table.timestamp('resets_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'limit_key']);
  });

  await knex.schema.createTable('telegram_sessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.specificType('session_data', 'bytea').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.string('device', 128);
    table.timestamp('last_used_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id'], 'idx_telegram_sessions_user_id');
  });

  await knex.schema.createTable('auth_states', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('state_token', 128).notNullable().unique();
    table.string('twofa_secret', 255);
    table.jsonb('backup_codes').notNullable().defaultTo(jsonbArray());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.boolean('is_used').notNullable().defaultTo(false);
    table.timestamp('used_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('parsing_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('query', 512).notNullable();
    table.string('status', 32).notNullable().defaultTo('pending');
    table.integer('result_count').notNullable().defaultTo(0);
    table.text('error_message');
    table.jsonb('metadata').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'created_at'], 'idx_parsing_history_user_created_at');
  });

  await knex.schema.createTable('parsed_channels', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('parsing_history_id').notNullable().references('id').inTable('parsing_history').onDelete('CASCADE');
    table.string('channel_id', 128).notNullable();
    table.string('title', 255);
    table.string('username', 128);
    table.integer('member_count').notNullable().defaultTo(0);
    table.boolean('is_verified').notNullable().defaultTo(false);
    table.jsonb('metadata').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['parsing_history_id', 'channel_id']);
  });

  await knex.schema.createTable('audience_segments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 128).notNullable();
    table.text('description');
    table.jsonb('filters').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'name']);
  });

  await knex.schema.createTable('broadcast_campaigns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('segment_id').references('id').inTable('audience_segments').onDelete('SET NULL');
    table.string('title', 255).notNullable();
    table.text('content').notNullable();
    table.string('status', 32).notNullable().defaultTo('draft');
    table.timestamp('scheduled_at', { useTz: true });
    table.timestamp('last_sent_at', { useTz: true });
    table.jsonb('metadata').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'status'], 'idx_broadcast_campaigns_user_status');
  });

  await knex.schema.createTable('broadcast_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('campaign_id').notNullable().references('id').inTable('broadcast_campaigns').onDelete('CASCADE');
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('recipient', 255).notNullable();
    table.string('status', 32).notNullable();
    table.text('error_message');
    table.jsonb('metadata').notNullable().defaultTo(jsonbObject());
    table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('subscription_id').references('id').inTable('subscriptions').onDelete('SET NULL');
    table.decimal('amount', 12, 2).notNullable();
    table.string('currency', 8).notNullable().defaultTo('RUB');
    table.string('status', 32).notNullable().defaultTo('pending');
    table.string('provider', 64).notNullable().defaultTo('robokassa');
    table.string('transaction_id', 128).notNullable().unique();
    table.jsonb('payload').notNullable().defaultTo(jsonbObject());
    table.timestamp('paid_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('error_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('level', 32).notNullable().defaultTo('error');
    table.text('message').notNullable();
    table.text('stacktrace');
    table.jsonb('context').notNullable().defaultTo(jsonbObject());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable().defaultTo(knex.raw("NOW() + INTERVAL '2 days'"));
    table.index(['created_at'], 'idx_error_logs_created_at');
  });

  await knex.schema.createTable('notification_queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('campaign_id').references('id').inTable('broadcast_campaigns').onDelete('SET NULL');
    table.string('channel', 32).notNullable();
    table.jsonb('payload').notNullable().defaultTo(jsonbObject());
    table.timestamp('scheduled_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('status', 32).notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('last_attempt_at', { useTz: true });
    table.text('error_message');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notification_queue');
  await knex.schema.dropTableIfExists('error_logs');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('broadcast_logs');
  await knex.schema.dropTableIfExists('broadcast_campaigns');
  await knex.schema.dropTableIfExists('audience_segments');
  await knex.schema.dropTableIfExists('parsed_channels');
  await knex.schema.dropTableIfExists('parsing_history');
  await knex.schema.dropTableIfExists('auth_states');
  await knex.schema.dropTableIfExists('telegram_sessions');
  await knex.schema.dropTableIfExists('usage_limits');
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('users');
  await knex.raw('DROP EXTENSION IF EXISTS "pgcrypto"');
};
