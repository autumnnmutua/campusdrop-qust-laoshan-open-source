-- Reference data only. No accounts, real student data, or fabricated coordinates.
INSERT INTO campuses (id, name, address) VALUES
('QUST_LAOSHAN', '青岛科技大学崂山校区', '山东省青岛市松岭路99号') ON CONFLICT(id) DO NOTHING;
INSERT INTO dorm_buildings (code, campus_id, zone, display_name, active, sort_order) VALUES
('SOUTH_01', 'QUST_LAOSHAN', 'SOUTH', '南苑1号楼', 1, 1),
('SOUTH_02', 'QUST_LAOSHAN', 'SOUTH', '南苑2号楼', 1, 2),
('SOUTH_03', 'QUST_LAOSHAN', 'SOUTH', '南苑3号楼', 1, 3),
('SOUTH_04', 'QUST_LAOSHAN', 'SOUTH', '南苑4号楼', 1, 4),
('SOUTH_05', 'QUST_LAOSHAN', 'SOUTH', '南苑5号楼', 1, 5),
('SOUTH_06', 'QUST_LAOSHAN', 'SOUTH', '南苑6号楼', 1, 6),
('SOUTH_07', 'QUST_LAOSHAN', 'SOUTH', '南苑7号楼', 1, 7),
('SOUTH_08', 'QUST_LAOSHAN', 'SOUTH', '南苑8号楼', 1, 8),
('SOUTH_09', 'QUST_LAOSHAN', 'SOUTH', '南苑9号楼', 1, 9),
('SOUTH_10', 'QUST_LAOSHAN', 'SOUTH', '南苑10号楼', 1, 10),
('SOUTH_11', 'QUST_LAOSHAN', 'SOUTH', '南苑11号楼', 1, 11),
('NORTH_01', 'QUST_LAOSHAN', 'NORTH', '北苑1号楼', 1, 1),
('NORTH_02', 'QUST_LAOSHAN', 'NORTH', '北苑2号楼', 1, 2),
('NORTH_03', 'QUST_LAOSHAN', 'NORTH', '北苑3号楼', 1, 3),
('NORTH_05', 'QUST_LAOSHAN', 'NORTH', '北苑5号楼', 1, 5),
('NORTH_06', 'QUST_LAOSHAN', 'NORTH', '北苑6号楼', 1, 6),
('NORTH_07', 'QUST_LAOSHAN', 'NORTH', '北苑7号楼', 1, 7),
('NORTH_08', 'QUST_LAOSHAN', 'NORTH', '北苑8号楼', 1, 8),
('NORTH_09', 'QUST_LAOSHAN', 'NORTH', '北苑9号楼', 1, 9)
ON CONFLICT(code) DO NOTHING;
INSERT INTO stations (code, campus_id, canonical_name, aliases_json, relative_location, lat, lng, active) VALUES
('YIHAIYUAN', 'QUST_LAOSHAN', '颐海苑（怡海苑）站点', '["颐海苑","怡海苑"]', '颐海苑浴室旁；南苑澡堂、浣熊洗衣对面，西南门上坡旁', NULL, NULL, 1)
ON CONFLICT(code) DO NOTHING;
