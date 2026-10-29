CREATE TABLE crew_preferences (
  owner TEXT PRIMARY KEY,
  autonomous INTEGER NOT NULL DEFAULT 1 CHECK(autonomous IN (0,1)),
  execute_demo INTEGER NOT NULL DEFAULT 1 CHECK(execute_demo IN (0,1)),
  sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0,1)),
  daily_report INTEGER NOT NULL DEFAULT 1 CHECK(daily_report IN (0,1)),
  report_email TEXT NOT NULL DEFAULT 'luizlz@gmail.com' CHECK(report_email='luizlz@gmail.com'),
  report_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  report_hour INTEGER NOT NULL DEFAULT 18 CHECK(report_hour BETWEEN 0 AND 23),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
