-- v3.0: merged delivery (order groups), standing delivery rules, weather linkage.
-- Only adds tables, columns, indexes and triggers; no existing row is deleted or rewritten.

-- ---------------------------------------------------------------- merged delivery (多件合并配送)
-- A group ties several ordinary one-parcel orders of the same student, the same station and the same delivery choice
-- together: paid in one go, claimed by one courier, one door code. Every order keeps all of its own rules (payment,
-- cancellation, refund, hand-back), so nothing in the existing order flow changes for a group member.
CREATE TABLE order_groups (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 station_code TEXT NOT NULL REFERENCES stations(code),
 origin TEXT NOT NULL DEFAULT 'STUDENT' CHECK(origin IN ('STUDENT','RULE')),
 rule_id TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX order_groups_user ON order_groups(user_id,created_at);
ALTER TABLE delivery_orders ADD COLUMN group_id TEXT REFERENCES order_groups(id);
-- Set when a standing rule created the order: such an unpaid order is held until its window closes for booking.
ALTER TABLE delivery_orders ADD COLUMN rule_id TEXT;
CREATE INDEX delivery_orders_group ON delivery_orders(group_id) WHERE group_id IS NOT NULL;

-- A group member must belong to the group's student and station.
CREATE TRIGGER order_group_guard BEFORE UPDATE OF group_id ON delivery_orders WHEN NEW.group_id IS NOT NULL AND OLD.group_id IS NOT NEW.group_id BEGIN
 SELECT RAISE(ABORT,'ORDER_GROUP_INVALID') WHERE NOT EXISTS(SELECT 1 FROM order_groups g WHERE g.id=NEW.group_id AND g.user_id=NEW.user_id AND g.station_code=NEW.station_code);
END;
CREATE TRIGGER order_group_insert_guard BEFORE INSERT ON delivery_orders WHEN NEW.group_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'ORDER_GROUP_INVALID') WHERE NOT EXISTS(SELECT 1 FROM order_groups g WHERE g.id=NEW.group_id AND g.user_id=NEW.user_id AND g.station_code=NEW.station_code);
END;

-- Student inbox: one message per change for a whole group instead of one per parcel. The first member to reach a
-- status writes it (with the number of parcels); members reaching the same status afterwards stay quiet.
DROP TRIGGER notify_order_status;
CREATE TRIGGER notify_order_status AFTER UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status
 AND (NEW.group_id IS NULL OR NOT EXISTS(SELECT 1 FROM delivery_orders s WHERE s.group_id=NEW.group_id AND s.id<>NEW.id AND s.status=NEW.status)) BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) VALUES(NEW.user_id,NEW.id,NEW.status,
  COALESCE(json_extract(NEW.dorm_snapshot_json,'$.buildingName'),'你的订单')
  ||IIF(NEW.group_id IS NULL OR NEW.status='CANCELLED','',' · 合并配送 '||(SELECT count(*) FROM delivery_orders s WHERE s.group_id=NEW.group_id AND (s.status<>'CANCELLED' OR s.id=NEW.id))||' 件')||' · '||CASE NEW.status
   WHEN 'WAITING_PICKUP' THEN '已支付，等待配送员接单'
   WHEN 'PICKED_UP' THEN '配送员已从站点取出包裹'
   WHEN 'OUT_FOR_DELIVERY' THEN '配送员已出发'
   WHEN 'DELIVERED_DOWNSTAIRS' THEN IIF(NEW.drop_place IS NULL,'包裹已送到楼下','包裹已送到约定地点')
   WHEN 'DELIVERED_TO_ROOM' THEN '包裹已送到寝室'
   WHEN 'COMPLETED' THEN '订单已完成'
   WHEN 'CANCELLED' THEN '订单已取消'
   WHEN 'FAILED_PICKUP' THEN '取件遇到问题，请查看说明'
   WHEN 'DELIVERY_EXCEPTION' THEN '配送遇到问题，请查看说明'
   ELSE '订单进度已更新' END);
END;
DROP TRIGGER notify_claim;
CREATE TRIGGER notify_claim AFTER INSERT ON batch_items
 WHEN NOT EXISTS(SELECT 1 FROM delivery_orders o JOIN delivery_orders s ON s.group_id=o.group_id AND s.id<>o.id JOIN batch_items bi ON bi.order_id=s.id
   WHERE o.id=NEW.order_id AND o.group_id IS NOT NULL) BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'CLAIMED',
  COALESCE(json_extract(dorm_snapshot_json,'$.buildingName'),'你的订单')||IIF(group_id IS NULL,'',' · 合并配送')||' · 配送员已接单，可查看联系电话' FROM delivery_orders WHERE id=NEW.order_id;
END;

-- ---------------------------------------------------------------- standing delivery rules (常用配送规则)
-- "On these weekdays, deliver whatever parcels I have in this window." The frequent job creates unpaid orders for
-- the student's waiting parcels a few hours before the window; the student only confirms the (mock) payment.
CREATE TABLE delivery_rules (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 weekdays INTEGER NOT NULL CHECK(weekdays BETWEEN 1 AND 127),   -- bit 0 = Monday … bit 6 = Sunday
 slot_code TEXT NOT NULL CHECK(slot_code IN ('NOON','EVENING','NIGHT')),
 delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('DOWNSTAIRS','ROOM')),
 drop_place TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 last_run_date TEXT,
 last_notice TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 CHECK(drop_place IS NULL OR delivery_mode='DOWNSTAIRS')
);
CREATE INDEX delivery_rules_active ON delivery_rules(active,slot_code);
CREATE INDEX delivery_rules_user ON delivery_rules(user_id);

-- ---------------------------------------------------------------- weather (天气联动)
-- One row of state (latest observation and the operator's choice) and an hourly log for the on-time dashboard.
CREATE TABLE weather_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 override TEXT NOT NULL DEFAULT 'AUTO' CHECK(override IN ('AUTO','CLEAR','WET','SEVERE')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=80),
 data_json TEXT CHECK(data_json IS NULL OR json_valid(data_json)),
 level TEXT NOT NULL DEFAULT 'CLEAR' CHECK(level IN ('CLEAR','WET','SEVERE')),
 fetched_at INTEGER,
 failed_at INTEGER,
 updated_by TEXT,
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
INSERT INTO weather_state(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE weather_log (
 hour TEXT PRIMARY KEY,              -- Beijing time, YYYY-MM-DDTHH
 level TEXT NOT NULL CHECK(level IN ('CLEAR','WET','SEVERE')),
 weather_code INTEGER,
 precipitation REAL,
 wind_gust REAL
);
