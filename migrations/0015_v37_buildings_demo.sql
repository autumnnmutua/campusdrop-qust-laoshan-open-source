-- © 2026 专业团队 · CampusDrop v4.5.0
-- v3.7: more delivery destinations and a third demo account. Only adds rows and one nullable column; nothing is deleted.
-- Per the project owner every building on the campus plan takes deliveries except 人才公寓 (staff flats), the canteens
-- and the teaching buildings. The new buildings use the two existing zones (北区 / 南区) so admin scopes keep working.
INSERT INTO dorm_buildings (code, campus_id, zone, display_name, active, sort_order) VALUES
('NORTH_B1', 'QUST_LAOSHAN', 'NORTH', '北1楼', 1, 21),
('NORTH_B2', 'QUST_LAOSHAN', 'NORTH', '北2楼', 1, 22),
('NORTH_B3', 'QUST_LAOSHAN', 'NORTH', '北3楼', 1, 23),
('NORTH_B4', 'QUST_LAOSHAN', 'NORTH', '北4楼', 1, 24),
('GYM', 'QUST_LAOSHAN', 'NORTH', '体育馆', 1, 25),
('EAST_1', 'QUST_LAOSHAN', 'NORTH', '东1楼', 1, 26),
('EAST_2', 'QUST_LAOSHAN', 'NORTH', '东2楼', 1, 27),
('EAST_3', 'QUST_LAOSHAN', 'NORTH', '东3楼', 1, 28),
('LIBRARY_HALL', 'QUST_LAOSHAN', 'SOUTH', '图书馆', 1, 21),
('ADMIN_HALL', 'QUST_LAOSHAN', 'SOUTH', '行政楼', 1, 22),
('ACTIVITY_CENTER', 'QUST_LAOSHAN', 'SOUTH', '大学生活动中心', 1, 23),
('ART_CENTER', 'QUST_LAOSHAN', 'SOUTH', '艺术教育中心', 1, 24)
ON CONFLICT(code) DO NOTHING;

-- One-click demo: the third account (v3.7.1: the demo's 超级管理员, fenced into its own demo).
ALTER TABLE demo_sessions ADD COLUMN senior_id TEXT REFERENCES admin_users(id);
