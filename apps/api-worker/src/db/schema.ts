import { drizzle } from 'drizzle-orm/d1';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
});

export const accounts = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', {
    mode: 'timestamp_ms',
  }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
    mode: 'timestamp_ms',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const verifications = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  provider: text('provider').notNull(),
  protocol: text('protocol', {
    enum: ['openai_chat_completions', 'anthropic_messages', 'gemini_contents'],
  }).notNull(),
  baseUrl: text('base_url').notNull(),
  modelsJson: text('models_json').notNull(),
  defaultTestModel: text('default_test_model'),
  status: text('status', { enum: ['active', 'disabled'] }).notNull(),
  configJson: text('config_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  keyPrefix: text('key_prefix').notNull().unique(),
  keyHash: text('key_hash').notNull().unique(),
  status: text('status', {
    enum: ['active', 'disabled', 'expired', 'revoked'],
  }).notNull(),
  expiresAt: integer('expires_at'),
  maxConcurrency: integer('max_concurrency').notNull(),
  requestQuotaLimit: integer('request_quota_limit'),
  createdByAdminId: text('created_by_admin_id').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const apiKeyChannelRules = sqliteTable(
  'api_key_channel_rules',
  {
    apiKeyId: text('api_key_id').notNull(),
    channelId: text('channel_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.apiKeyId, table.channelId] })]
);

export const apiKeyEndpointRules = sqliteTable(
  'api_key_endpoint_rules',
  {
    apiKeyId: text('api_key_id').notNull(),
    endpoint: text('endpoint', {
      enum: ['openai_chat_completions', 'anthropic_messages', 'gemini_contents'],
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.apiKeyId, table.endpoint] })]
);

export const portalSessions = sqliteTable('portal_sessions', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
});

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id').notNull(),
  endpoint: text('endpoint').notNull(),
  model: text('model'),
  channelId: text('channel_id'),
  traceId: text('trace_id'),
  status: text('status', {
    enum: ['pending', 'processing', 'completed', 'failed', 'rejected'],
  }).notNull(),
  failureClass: text('failure_class', {
    enum: ['invalid_request', 'auth_error', 'upstream_error', 'upstream_timeout', 'network_error'],
  }),
  httpStatus: integer('http_status'),
  latencyMs: integer('latency_ms'),
  requestSize: integer('request_size'),
  responseSize: integer('response_size'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  totalCostMicros: integer('total_cost_micros'),
  tokenUsageAvailability: text('token_usage_availability', {
    enum: ['available', 'unavailable'],
  }).notNull(),
  payloadRef: text('payload_ref'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  createdAt: integer('created_at').notNull(),
});

export const schema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  channels,
  apiKeys,
  apiKeyChannelRules,
  apiKeyEndpointRules,
  portalSessions,
  requests,
};

export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}
