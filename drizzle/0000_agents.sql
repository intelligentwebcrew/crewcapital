CREATE TABLE crew_config (owner TEXT PRIMARY KEY, broker_cipher TEXT, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE crew_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, error TEXT, proposal TEXT, order_state TEXT NOT NULL DEFAULT 'none');
--> statement-breakpoint
CREATE INDEX crew_runs_owner ON crew_runs(owner, started_at);
--> statement-breakpoint
CREATE UNIQUE INDEX crew_one_active_run ON crew_runs(owner) WHERE status='running';
--> statement-breakpoint
CREATE TABLE crew_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, run_id TEXT NOT NULL, agent TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX crew_events_owner ON crew_events(owner, id);
--> statement-breakpoint
CREATE TABLE crew_day (owner TEXT NOT NULL, day TEXT NOT NULL, baseline_nav REAL NOT NULL, PRIMARY KEY(owner,day));
