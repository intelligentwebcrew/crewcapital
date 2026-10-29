ALTER TABLE crew_runs ADD COLUMN arm TEXT NOT NULL DEFAULT 'ai';
--> statement-breakpoint
ALTER TABLE crew_runs ADD COLUMN candle_time TEXT;
--> statement-breakpoint
ALTER TABLE crew_runs ADD COLUMN benchmark TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX crew_one_candle ON crew_runs(owner,candle_time) WHERE candle_time IS NOT NULL;
--> statement-breakpoint
CREATE TABLE crew_calls (id TEXT PRIMARY KEY,owner TEXT NOT NULL,run_id TEXT NOT NULL,agent TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,input_tokens INTEGER,cached_tokens INTEGER,output_tokens INTEGER,cost_usd REAL,rate_version TEXT,reserved_usd REAL NOT NULL DEFAULT 0.01,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX crew_calls_owner ON crew_calls(owner,created_at);
--> statement-breakpoint
CREATE TABLE crew_trades (trade_id TEXT NOT NULL,owner TEXT NOT NULL,account_id TEXT NOT NULL,run_id TEXT NOT NULL,arm TEXT NOT NULL,state TEXT NOT NULL,entry_price REAL,exit_price REAL,units REAL,planned_risk REAL,entry_spread_pips REAL,opened_at TEXT,closed_at TEXT,realized_pl REAL,financing REAL,commission REAL,guaranteed_fees REAL,net_broker REAL,last_sync TEXT,sync_error TEXT,PRIMARY KEY(owner,trade_id));
--> statement-breakpoint
ALTER TABLE crew_config ADD COLUMN openai_cipher TEXT;
--> statement-breakpoint
ALTER TABLE crew_runs ADD COLUMN scan TEXT;
--> statement-breakpoint
ALTER TABLE crew_trades ADD COLUMN instrument TEXT;
--> statement-breakpoint
CREATE TABLE crew_calendar (id TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at TEXT NOT NULL);
