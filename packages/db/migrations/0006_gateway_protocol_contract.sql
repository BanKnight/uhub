ALTER TABLE api_key_endpoint_rules RENAME TO api_key_endpoint_rules_old;

CREATE TABLE api_key_endpoint_rules (
  api_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL CHECK(endpoint IN ('openai_chat_completions', 'anthropic_messages', 'gemini_contents')),
  PRIMARY KEY (api_key_id, endpoint)
);

INSERT INTO api_key_endpoint_rules (api_key_id, endpoint)
SELECT api_key_id, endpoint
FROM api_key_endpoint_rules_old;

DROP TABLE api_key_endpoint_rules_old;
