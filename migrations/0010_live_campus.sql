-- v2.5 / v2.6: handoff codes, delivery slots, order chat, courier location, campus map calibration, web push and
-- self-service account deletion. Additive only: existing rows keep working, new columns default to NULL.

-- ---------------------------------------------------------------- handoff code (收货码)
ALTER TABLE delivery_orders ADD COLUMN handoff_code TEXT CHECK(handoff_code IS NULL OR (length(handoff_code)=4 AND handoff_code GLOB '[0-9][0-9][0-9][0-9]'));
ALTER TABLE delivery_orders ADD COLUMN handoff_verified_at INTEGER;
UPDATE delivery_orders SET handoff_code=printf('%04d',abs(random())%10000) WHERE status NOT IN ('COMPLETED','CANCELLED');

-- A courier may complete an order only after entering the code the student shows in person.
DROP TRIGGER student_receipt_guard;
CREATE TRIGGER student_receipt_guard BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status AND NEW.status='COMPLETED' BEGIN
 SELECT RAISE(ABORT,'STUDENT_RECEIPT_REQUIRED') WHERE NEW.received_at IS NULL OR NOT (
  (NEW.last_actor_type='STUDENT' AND NEW.last_actor_id=NEW.user_id) OR
  (NEW.last_actor_type='ADMIN' AND NEW.handoff_verified_at IS NOT NULL)
 );
END;

-- ---------------------------------------------------------------- delivery slots (预约配送时段)
ALTER TABLE delivery_orders ADD COLUMN slot_date TEXT CHECK(slot_date IS NULL OR slot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE delivery_orders ADD COLUMN slot_code TEXT CHECK(slot_code IS NULL OR slot_code IN ('NOON','EVENING','NIGHT'));
CREATE INDEX order_slot_load ON delivery_orders(slot_date,slot_code,status) WHERE slot_date IS NOT NULL;

-- ---------------------------------------------------------------- order chat (站内聊天)
CREATE TABLE order_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
 sender_kind TEXT NOT NULL CHECK(sender_kind IN ('STUDENT','ADMIN')),
 sender_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 300),
 read_at INTEGER,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX order_message_thread ON order_messages(order_id,id);
-- Inbox rows are the fan-out source for live events and web push; pushed_at claims each row exactly once.
ALTER TABLE inbox_messages ADD COLUMN pushed_at INTEGER;
UPDATE inbox_messages SET pushed_at=created_at;
CREATE TRIGGER notify_order_chat AFTER INSERT ON order_messages WHEN NEW.sender_kind='ADMIN' BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'CHAT','配送员发来一条新消息' FROM delivery_orders WHERE id=NEW.order_id;
END;

-- ---------------------------------------------------------------- courier location and map calibration (校园地图)
CREATE TABLE courier_locations (
 admin_id TEXT PRIMARY KEY REFERENCES admin_users(id),
 lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
 lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
 accuracy REAL NOT NULL CHECK(accuracy>=0),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
-- Two GPS fixes taken at two known map landmarks; positions in between are projected linearly. No coordinates ship
-- with the project: until a super admin calibrates on site, the map shows estimated positions only.
CREATE TABLE map_calibration (
 campus_id TEXT PRIMARY KEY REFERENCES campuses(id),
 points_json TEXT NOT NULL CHECK(json_valid(points_json)),
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);

-- ---------------------------------------------------------------- web push
CREATE TABLE push_subscriptions (
 endpoint TEXT PRIMARY KEY CHECK(length(endpoint)<=1000),
 owner_kind TEXT NOT NULL CHECK(owner_kind IN ('STUDENT','ADMIN')),
 owner_id TEXT NOT NULL,
 p256dh TEXT NOT NULL CHECK(length(p256dh)<=200),
 auth TEXT NOT NULL CHECK(length(auth)<=100),
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX push_owner ON push_subscriptions(owner_kind,owner_id);

-- ---------------------------------------------------------------- account deletion (账号注销)
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
-- Order snapshots stay immutable, except that a deleted account's name, phone and room are scrubbed from them.
DROP TRIGGER order_snapshot_immutable;
CREATE TRIGGER order_snapshot_immutable BEFORE UPDATE OF parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,price_snapshot_json,dorm_snapshot_json,station_snapshot_json ON delivery_orders
WHEN NOT (
 EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND deleted_at IS NOT NULL)
 AND NEW.parcel_id IS OLD.parcel_id AND NEW.user_id IS OLD.user_id AND NEW.campus_id IS OLD.campus_id AND NEW.zone IS OLD.zone
 AND NEW.dorm_building_code IS OLD.dorm_building_code AND NEW.station_code IS OLD.station_code AND NEW.package_size IS OLD.package_size
 AND NEW.delivery_mode IS OLD.delivery_mode AND NEW.amount_fen IS OLD.amount_fen AND NEW.price_snapshot_json IS OLD.price_snapshot_json
 AND NEW.station_snapshot_json IS OLD.station_snapshot_json
) BEGIN
 SELECT RAISE(ABORT,'ORDER_SNAPSHOT_IMMUTABLE');
END;
