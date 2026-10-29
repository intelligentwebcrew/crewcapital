CREATE TABLE crew_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX crew_sessions_expiry ON crew_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE crew_login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
