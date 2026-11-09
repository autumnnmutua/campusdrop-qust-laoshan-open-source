-- © 2026 专业团队 · CampusDrop v4.5.0
-- v3.6: one-click demo ("一键体验"). Each demo is a pair of throw-away accounts — a student and a courier — sharing a
-- demo_group id. Orders made by a demo student carry the same id, so real operators, couriers, dashboards, slot
-- capacity and group notifications never see them, and the demo courier sees only its own student's orders.
-- Three nullable columns, one table, two indexes (existing rows keep demo_group NULL = real), plus the ai_usage
-- rebuild at the end for the vision cap.
ALTER TABLE users ADD COLUMN demo_group TEXT;
ALTER TABLE admin_users ADD COLUMN demo_group TEXT;
ALTER TABLE delivery_orders ADD COLUMN demo_group TEXT;
CREATE INDEX delivery_orders_demo_group ON delivery_orders(demo_group) WHERE demo_group IS NOT NULL;

CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  -- 1 = the simulated courier moves the orders along by itself; 0 = the visitor plays the courier.
  auto INTEGER NOT NULL DEFAULT 1 CHECK (auto IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER
);
CREATE INDEX demo_sessions_open ON demo_sessions(created_at) WHERE ended_at IS NULL;

-- v3.6: the screenshot vision fallback (截图识别大模型兜底) gets its own daily cap. SQLite cannot change a CHECK in
-- place, so ai_usage is rebuilt with the extra kind; existing counts are copied over.
CREATE TABLE ai_usage_v36 (
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL CHECK (kind IN ('ASSISTANT', 'OPS_SUMMARY', 'VISION')),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  fallbacks INTEGER NOT NULL DEFAULT 0 CHECK (fallbacks >= 0),
  PRIMARY KEY (day, kind)
);
INSERT INTO ai_usage_v36(day,kind,calls,fallbacks) SELECT day,kind,calls,fallbacks FROM ai_usage;
DROP TABLE ai_usage;
ALTER TABLE ai_usage_v36 RENAME TO ai_usage;
