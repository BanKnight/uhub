ALTER TABLE requests ADD COLUMN failure_class TEXT CHECK(failure_class IN ('invalid_request', 'auth_error', 'upstream_error', 'upstream_timeout', 'network_error'));
