-- v2.7: drop-off points, roommate pickup links, "almost there" notices, delivery photos, parcel reminders, send
-- service (代寄件), courier shifts, operations settings (ordering pause, group webhook), targeted announcements,
-- clearer inbox titles and an index for delivery-time history. Additive: no existing row is deleted.

-- ---------------------------------------------------------------- orders: drop-off point, roommate pickup, near notice
-- A drop-off point replaces "downstairs" with a campus landmark (library, canteen …); it is priced as downstairs and
-- can never be upgraded to room delivery.
ALTER TABLE delivery_orders ADD COLUMN drop_place TEXT CHECK(drop_place IS NULL OR (delivery_mode='DOWNSTAIRS' AND drop_place IN ('LIBRARY','SOUTH_CANTEEN','NORTH_CANTEEN','STADIUM','SOUTH_GATE','WEST_GATE','EAST_GATE')));
-- Roommate pickup: a short name the courier sees ("室友小王") and a revocable read-only tracking link.
ALTER TABLE delivery_orders ADD COLUMN proxy_name TEXT NOT NULL DEFAULT '' CHECK(length(proxy_name)<=16);
ALTER TABLE delivery_orders ADD COLUMN share_token TEXT CHECK(share_token IS NULL OR (length(share_token)=32 AND share_token NOT GLOB '*[^0-9a-f]*'));
CREATE UNIQUE INDEX order_share_token ON delivery_orders(share_token) WHERE share_token IS NOT NULL;
-- Set once when the student has been told the courier is about to arrive (GPS proximity or the courier's button).
ALTER TABLE delivery_orders ADD COLUMN near_notified_at INTEGER;

CREATE TRIGGER drop_place_immutable BEFORE UPDATE OF drop_place ON delivery_orders WHEN NEW.drop_place IS NOT OLD.drop_place BEGIN
 SELECT RAISE(ABORT,'ORDER_SNAPSHOT_IMMUTABLE');
END;

-- Room upgrades stay limited to plain downstairs orders (not drop-off points).
DROP TRIGGER adjustment_guard;
CREATE TRIGGER adjustment_guard BEFORE INSERT ON order_adjustments BEGIN
 SELECT RAISE(ABORT,'UPGRADE_NOT_ALLOWED') WHERE NEW.kind='UPGRADE' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.delivery_mode='DOWNSTAIRS' AND o.drop_place IS NULL AND o.delivery_upgrade_fen=0 AND o.student_deleted=0
 AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY') AND ((o.package_size='LARGE' AND NEW.amount_fen=200) OR (o.package_size='SMALL' AND NEW.amount_fen=100)) AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY'));
 SELECT RAISE(ABORT,'REFUND_NOT_ALLOWED') WHERE NEW.kind='REFUND' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND (o.student_deleted=1 OR o.student_cancelled=1) AND o.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')
 AND NEW.amount_fen=(SELECT amount_fen FROM payments WHERE order_id=o.id AND type='DELIVERY')+o.delivery_upgrade_fen+o.upgrade_surcharge_fen);
END;

-- ---------------------------------------------------------------- delivery photos (送达拍照存证)
-- Small compressed photos (≤ 200 KB) kept in D1 for 30 days, then removed by the daily job. Visible to the order's
-- student and to admins who can see the order.
CREATE TABLE delivery_photos (
 order_id TEXT PRIMARY KEY REFERENCES delivery_orders(id) ON DELETE CASCADE,
 admin_id TEXT NOT NULL REFERENCES admin_users(id),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/webp')),
 bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 204800),
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX delivery_photo_age ON delivery_photos(created_at);

-- ---------------------------------------------------------------- parcel reminders (包裹到站太久提醒)
ALTER TABLE parcels ADD COLUMN reminded_at INTEGER;

-- ---------------------------------------------------------------- send service (代寄件)
-- The courier collects a parcel from the student's room in a booked window and hands it in at the station.
CREATE TABLE send_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 campus_id TEXT NOT NULL REFERENCES campuses(id),
 zone TEXT NOT NULL CHECK(zone IN ('SOUTH','NORTH')),
 dorm_building_code TEXT NOT NULL REFERENCES dorm_buildings(code),
 dorm_snapshot_json TEXT NOT NULL CHECK(json_valid(dorm_snapshot_json)),
 station_code TEXT NOT NULL REFERENCES stations(code),
 package_size TEXT NOT NULL CHECK(package_size IN ('SMALL','LARGE')),
 carrier TEXT NOT NULL CHECK(length(carrier) BETWEEN 1 AND 12),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=120),
 slot_date TEXT NOT NULL CHECK(slot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 slot_code TEXT NOT NULL CHECK(slot_code IN ('NOON','EVENING','NIGHT')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen = CASE WHEN package_size='SMALL' THEN 300 ELSE 700 END),
 status TEXT NOT NULL DEFAULT 'WAITING_PICKUP' CHECK(status IN ('WAITING_PICKUP','PICKED_UP','DROPPED','CANCELLED')),
 assignee_admin_id TEXT REFERENCES admin_users(id),
 tracking_no TEXT NOT NULL DEFAULT '' CHECK(length(tracking_no)<=40),
 cancel_reason TEXT NOT NULL DEFAULT '' CHECK(length(cancel_reason)<=120),
 refunded_fen INTEGER NOT NULL DEFAULT 0 CHECK(refunded_fen IN (0,amount_fen)),
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
 picked_at INTEGER,
 dropped_at INTEGER
);
CREATE INDEX send_owner ON send_requests(user_id,created_at DESC,id DESC);
CREATE INDEX send_pool ON send_requests(status,slot_date,slot_code);
CREATE INDEX send_assignee ON send_requests(assignee_admin_id,status);
CREATE TRIGGER send_transition_guard BEFORE UPDATE OF status ON send_requests WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'INVALID_TRANSITION') WHERE NOT (
  (OLD.status='WAITING_PICKUP' AND NEW.status='PICKED_UP' AND NEW.assignee_admin_id IS NOT NULL) OR
  (OLD.status='WAITING_PICKUP' AND NEW.status='CANCELLED') OR
  (OLD.status='PICKED_UP' AND NEW.status='DROPPED' AND NEW.assignee_admin_id IS NOT NULL) OR
  (OLD.status='PICKED_UP' AND NEW.status='CANCELLED' AND length(NEW.cancel_reason)>0)
 );
END;
CREATE TRIGGER send_snapshot_immutable BEFORE UPDATE OF user_id,campus_id,zone,dorm_building_code,station_code,package_size,amount_fen,slot_date,slot_code ON send_requests BEGIN
 SELECT RAISE(ABORT,'ORDER_SNAPSHOT_IMMUTABLE');
END;
CREATE TRIGGER send_status_audit AFTER UPDATE OF status ON send_requests WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(lower(hex(randomblob(16))),'SYSTEM',COALESCE(NEW.assignee_admin_id,NEW.user_id),'SEND_STATUS_CHANGED',NEW.id,json_object('from',OLD.status,'to',NEW.status));
END;

-- ---------------------------------------------------------------- courier shifts (排班)
CREATE TABLE courier_shifts (
 admin_id TEXT NOT NULL REFERENCES admin_users(id),
 slot_date TEXT NOT NULL CHECK(slot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 slot_code TEXT NOT NULL CHECK(slot_code IN ('NOON','EVENING','NIGHT')),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 PRIMARY KEY(admin_id,slot_date,slot_code)
);
CREATE INDEX shift_slot ON courier_shifts(slot_date,slot_code);

-- ---------------------------------------------------------------- operations settings
-- ordering_pause: {"paused":true,"reason":"…"}; webhook: {"kind":"wecom"|"feishu","url":"…","events":[…]};
-- shift_capacity: {"enabled":true,"quota":{"NOON":15,…}}. Written only by super admins through the API.
CREATE TABLE app_settings (
 key TEXT PRIMARY KEY CHECK(key IN ('ordering_pause','webhook','shift_capacity')),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
-- Each group notification is sent once (new order, stalled order …).
CREATE TABLE webhook_log (
 key TEXT PRIMARY KEY,
 sent_at INTEGER NOT NULL DEFAULT(unixepoch())
);

-- ---------------------------------------------------------------- announcements: building targeting
ALTER TABLE announcements ADD COLUMN target_json TEXT CHECK(target_json IS NULL OR (json_valid(target_json) AND json_type(target_json)='array'));

-- ---------------------------------------------------------------- inbox: deep link for non-order rows, clearer titles
ALTER TABLE inbox_messages ADD COLUMN link TEXT CHECK(link IS NULL OR (link GLOB '/*' AND length(link)<=80));

DROP TRIGGER notify_order_status;
CREATE TRIGGER notify_order_status AFTER UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) VALUES(NEW.user_id,NEW.id,NEW.status,
  COALESCE(json_extract(NEW.dorm_snapshot_json,'$.buildingName'),'你的订单')||' · '||CASE NEW.status
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
CREATE TRIGGER notify_claim AFTER INSERT ON batch_items BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'CLAIMED',COALESCE(json_extract(dorm_snapshot_json,'$.buildingName'),'你的订单')||' · 配送员已接单，可查看联系电话' FROM delivery_orders WHERE id=NEW.order_id;
END;
CREATE TRIGGER notify_send_status AFTER UPDATE OF status ON send_requests WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO inbox_messages(user_id,kind,title,link) VALUES(NEW.user_id,'SEND_'||NEW.status,'代寄件 · '||CASE NEW.status
   WHEN 'PICKED_UP' THEN '配送员已上门取走包裹'
   WHEN 'DROPPED' THEN '包裹已交到站点寄出'
   WHEN 'CANCELLED' THEN '寄件已取消，模拟退款已记录'
   ELSE '进度已更新' END,'/send/'||NEW.id);
END;
CREATE TRIGGER notify_send_claim AFTER UPDATE OF assignee_admin_id ON send_requests WHEN OLD.assignee_admin_id IS NULL AND NEW.assignee_admin_id IS NOT NULL BEGIN
 INSERT INTO inbox_messages(user_id,kind,title,link) VALUES(NEW.user_id,'SEND_CLAIMED','代寄件 · 配送员已接单，会在预约时段上门','/send/'||NEW.id);
END;

-- ---------------------------------------------------------------- delivery-time history (ETA) lookups
CREATE INDEX order_event_status_time ON order_events(to_status,created_at);
