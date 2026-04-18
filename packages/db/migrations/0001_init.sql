CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL
);

CREATE INDEX session_userId_idx ON session(userId);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX account_userId_idx ON account(userId);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('openai_chat_completions', 'anthropic_messages', 'gemini_contents')),
  base_url TEXT NOT NULL,
  models_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('active', 'disabled', 'expired', 'revoked')),
  expires_at INTEGER,
  max_concurrency INTEGER NOT NULL,
  request_quota_limit INTEGER,
  created_by_admin_id TEXT NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_key_channel_rules (
  api_key_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (api_key_id, channel_id)
);

CREATE TABLE api_key_endpoint_rules (
  api_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL CHECK(endpoint IN ('openai_chat_completions', 'anthropic_messages', 'gemini_contents')),
  PRIMARY KEY (api_key_id, endpoint)
);

CREATE TABLE portal_sessions (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model TEXT,
  channel_id TEXT,
  trace_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'rejected')),
  http_status INTEGER,
  latency_ms INTEGER,
  request_size INTEGER,
  response_size INTEGER,
  payload_ref TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_requests_api_key_created_at ON requests(api_key_id, created_at DESC);
CREATE INDEX idx_requests_trace_id ON requests(trace_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_portal_sessions_api_key_id ON portal_sessions(api_key_id);
CREATE INDEX idx_channels_status ON channels(status);
