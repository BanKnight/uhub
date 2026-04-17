WITH ranked_rules AS (
  SELECT
    rowid,
    ROW_NUMBER() OVER (
      PARTITION BY api_key_id
      ORDER BY rowid
    ) - 1 AS computed_position
  FROM api_key_channel_rules
)
UPDATE api_key_channel_rules
SET position = (
  SELECT computed_position
  FROM ranked_rules
  WHERE ranked_rules.rowid = api_key_channel_rules.rowid
)
WHERE rowid IN (SELECT rowid FROM ranked_rules);
