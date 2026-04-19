ALTER TABLE requests ADD COLUMN input_tokens INTEGER;
ALTER TABLE requests ADD COLUMN output_tokens INTEGER;
ALTER TABLE requests ADD COLUMN total_tokens INTEGER;
ALTER TABLE requests ADD COLUMN token_usage_availability TEXT NOT NULL DEFAULT 'unavailable' CHECK(token_usage_availability IN ('available', 'unavailable'));
