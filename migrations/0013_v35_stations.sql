-- © 2026 专业团队 · CampusDrop v4.0.0
-- v3.5: a second station (南苑十号楼对面, receives and sends parcels), 北苑4号楼 (built since the 2012 plan), station
-- ordering, and the AI assistant's per-day usage counter. Only adds a column, rows and a table; nothing is deleted.
ALTER TABLE stations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 9;
UPDATE stations SET sort_order = 1 WHERE code = 'YIHAIYUAN';
INSERT INTO stations (code, campus_id, canonical_name, aliases_json, relative_location, lat, lng, active, sort_order) VALUES
('NANSHI', 'QUST_LAOSHAN', '南苑十号楼对面站点',
 '["南十对面","南苑十号楼对面","南苑10号楼对面","10号楼对面","南十驿站","南苑十号楼","南苑10号楼"]',
 '南苑10号学生宿舍对面的菜鸟驿站，可取件、可寄件', NULL, NULL, 1, 2)
ON CONFLICT(code) DO NOTHING;
INSERT INTO dorm_buildings (code, campus_id, zone, display_name, active, sort_order) VALUES
('NORTH_04', 'QUST_LAOSHAN', 'NORTH', '北苑4号楼', 1, 4)
ON CONFLICT(code) DO NOTHING;
-- AI assistant and 运营小结: one row per day and kind, so a deployment can cap model calls (cost control).
CREATE TABLE ai_usage (
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL CHECK (kind IN ('ASSISTANT', 'OPS_SUMMARY')),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  fallbacks INTEGER NOT NULL DEFAULT 0 CHECK (fallbacks >= 0),
  PRIMARY KEY (day, kind)
);
