ALTER TABLE channels ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai_chat_completions';
ALTER TABLE channels ADD COLUMN models_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE api_keys ADD COLUMN request_quota_limit INTEGER;
