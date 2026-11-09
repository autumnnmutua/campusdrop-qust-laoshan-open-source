-- © 2026 专业团队 · CampusDrop v4.5.0
-- v4.5: 超大件, the rain surcharge, small parcels handed to the courier responsible for the building, and students
-- applying to deliver. Adds columns, tables and triggers; replaces payment_guard and courier_earn_delivery so they count
-- the new amounts. Nothing is deleted or rewritten.

-- ---------------------------------------------------------------- 超大件
-- The size columns keep their two values (their CHECKs cannot change without rebuilding the tables): a 超大件 is a 大件
-- with oversize = 1, and its order carries a fixed 3 元 on top of the 大件 price (8 元 楼下 / 10 元 送寝).
ALTER TABLE parcels ADD COLUMN oversize INTEGER NOT NULL DEFAULT 0 CHECK (oversize IN (0, 1));
ALTER TABLE delivery_orders ADD COLUMN oversize_fen INTEGER NOT NULL DEFAULT 0 CHECK (oversize_fen IN (0, 300));
CREATE TRIGGER parcel_oversize_guard BEFORE INSERT ON parcels WHEN NEW.oversize = 1 AND NEW.size <> 'LARGE' BEGIN
  SELECT RAISE(ABORT, 'OVERSIZE_INVALID');
END;
CREATE TRIGGER parcel_oversize_fixed BEFORE UPDATE OF oversize, size ON parcels
WHEN NEW.oversize IS NOT OLD.oversize OR NEW.size IS NOT OLD.size BEGIN
  SELECT RAISE(ABORT, 'OVERSIZE_INVALID');
END;
-- An order's surcharge matches its parcel, and never changes afterwards.
CREATE TRIGGER order_oversize_guard BEFORE INSERT ON delivery_orders WHEN NEW.demo_history = 0 BEGIN
  SELECT RAISE(ABORT, 'OVERSIZE_INVALID') WHERE NEW.oversize_fen <> CASE WHEN EXISTS (
    SELECT 1 FROM parcels p WHERE p.id = NEW.parcel_id AND p.oversize = 1) THEN 300 ELSE 0 END;
END;
CREATE TRIGGER order_oversize_fixed BEFORE UPDATE OF oversize_fen ON delivery_orders WHEN NEW.oversize_fen IS NOT OLD.oversize_fen BEGIN
  SELECT RAISE(ABORT, 'OVERSIZE_INVALID');
END;

-- ---------------------------------------------------------------- rain surcharge (中雨、大雨、暴雨)
-- 2 元 per payment (每次下单), split over the orders paid together; of it 0.50 元 is the platform's and 1.50 元 the
-- courier's (rain_fee_fen is the platform part). Fixed once the order is paid.
ALTER TABLE delivery_orders ADD COLUMN rain_fen INTEGER NOT NULL DEFAULT 0 CHECK (rain_fen BETWEEN 0 AND 200);
ALTER TABLE delivery_orders ADD COLUMN rain_fee_fen INTEGER NOT NULL DEFAULT 0 CHECK (rain_fee_fen BETWEEN 0 AND 50);
CREATE TRIGGER rain_fixed BEFORE UPDATE OF rain_fen, rain_fee_fen ON delivery_orders
WHEN OLD.status <> 'WAITING_PAYMENT' AND (NEW.rain_fen IS NOT OLD.rain_fen OR NEW.rain_fee_fen IS NOT OLD.rain_fee_fen) BEGIN
  SELECT RAISE(ABORT, 'DISCOUNT_FIXED');
END;
CREATE TRIGGER rain_split_guard BEFORE UPDATE OF rain_fen, rain_fee_fen ON delivery_orders WHEN NEW.rain_fee_fen > NEW.rain_fen BEGIN
  SELECT RAISE(ABORT, 'RAIN_INVALID');
END;
-- Operator switch: AUTO follows the observed weather (moderate or heavier rain), ON / OFF override it.
ALTER TABLE weather_state ADD COLUMN rain_surcharge TEXT NOT NULL DEFAULT 'AUTO' CHECK (rain_surcharge IN ('AUTO', 'ON', 'OFF'));

-- The payment of an order = fee (incl. 超大件) + rain − coupon − 满减.
DROP TRIGGER payment_guard;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_ORDER_INVALID') WHERE NEW.type = 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id
    AND (status = 'WAITING_PAYMENT' OR demo_history = 1) AND amount_fen + oversize_fen + rain_fen - discount_fen - bundle_discount_fen = NEW.amount_fen);
  SELECT RAISE(ABORT, 'TIP_ORDER_INVALID') WHERE NEW.type = 'TIP' AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND status = 'COMPLETED');
END;

-- Courier wallet: full fee incl. 超大件 and the rain share, minus 0.20 元 and the platform's part of the rain surcharge.
DROP TRIGGER courier_earn_delivery;
CREATE TRIGGER courier_earn_delivery AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' AND NEW.demo_history = 0 BEGIN
  INSERT OR IGNORE INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  SELECT lower(hex(randomblob(16))), b.assignee_admin_id, 'DELIVERY', NEW.id,
    NEW.amount_fen + NEW.oversize_fen + NEW.delivery_upgrade_fen + NEW.upgrade_surcharge_fen + NEW.rain_fen, 20 + NEW.rain_fee_fen,
    NEW.amount_fen + NEW.oversize_fen + NEW.delivery_upgrade_fen + NEW.upgrade_surcharge_fen + NEW.rain_fen - 20 - NEW.rain_fee_fen,
    coalesce(NEW.received_at, unixepoch())
  FROM batch_items bi JOIN delivery_batches b ON b.id = bi.batch_id WHERE bi.order_id = NEW.id;
END;

-- ---------------------------------------------------------------- 小件按楼分配 (dispatch by building)
-- Each building has at most one courier for small parcels, per world ('' = the real site; a demo has its own).
CREATE TABLE building_couriers (
  world TEXT NOT NULL DEFAULT '',
  building_code TEXT NOT NULL REFERENCES dorm_buildings(code),
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  assigned_by TEXT REFERENCES admin_users(id),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (world, building_code)
);
CREATE INDEX building_couriers_admin ON building_couriers(admin_id);
-- When a small parcel is paid it goes straight to that courier (as if they had taken it from the market; the parcels of
-- one merged delivery share a batch). 大件 and 超大件, groups that contain one, buildings without an active courier, and
-- the shared test data stay in the 接单市场. The courier can still hand an order back to the market the usual way.
CREATE TRIGGER small_order_dispatch AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'WAITING_PICKUP' AND OLD.status = 'WAITING_PAYMENT' AND NEW.package_size = 'SMALL' AND NEW.demo_history = 0
  AND (NEW.group_id IS NULL OR NOT EXISTS (SELECT 1 FROM delivery_orders g WHERE g.group_id = NEW.group_id AND g.package_size <> 'SMALL'))
  AND NOT EXISTS (SELECT 1 FROM batch_items WHERE order_id = NEW.id) BEGIN
  INSERT OR IGNORE INTO delivery_batches (id, station_code, assignee_admin_id, created_by, created_at)
  SELECT 'auto-' || coalesce(NEW.group_id, NEW.id), NEW.station_code, bc.admin_id, bc.admin_id, unixepoch()
  FROM building_couriers bc JOIN admin_users a ON a.id = bc.admin_id AND a.status = 'ACTIVE' AND a.phone IS NOT NULL AND a.phone <> ''
    AND coalesce(a.demo_group, '') = bc.world
  WHERE bc.world = coalesce(NEW.demo_group, '') AND bc.building_code = NEW.dorm_building_code;
  INSERT INTO batch_items (batch_id, order_id, sort_order)
  SELECT 'auto-' || coalesce(NEW.group_id, NEW.id), NEW.id, 0 WHERE EXISTS (SELECT 1 FROM delivery_batches b WHERE b.id = 'auto-' || coalesce(NEW.group_id, NEW.id)
    AND b.station_code = NEW.station_code AND EXISTS (SELECT 1 FROM admin_users a WHERE a.id = b.assignee_admin_id AND a.status = 'ACTIVE'))
    AND NOT EXISTS (SELECT 1 FROM batch_items WHERE order_id = NEW.id);
END;

-- ---------------------------------------------------------------- 同学申请当配送员
-- A student applies with the username and password they want for the courier workspace (only a hash is kept); a super
-- admin approves (the courier account is created from it) or declines with a reason.
CREATE TABLE courier_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  real_name TEXT NOT NULL CHECK (length(real_name) BETWEEN 1 AND 20),
  phone TEXT NOT NULL CHECK (length(phone) = 11),
  college TEXT NOT NULL DEFAULT '' CHECK (length(college) <= 40),
  grade TEXT NOT NULL DEFAULT '' CHECK (length(grade) <= 20),
  slots_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(slots_json) AND json_type(slots_json) = 'array'),
  zone TEXT CHECK (zone IS NULL OR zone IN ('SOUTH', 'NORTH')),
  -- Where the student lives (helps hand them the buildings next to theirs).
  building_code TEXT REFERENCES dorm_buildings(code),
  room_no TEXT NOT NULL DEFAULT '' CHECK (length(room_no) <= 32),
  intro TEXT NOT NULL DEFAULT '' CHECK (length(intro) <= 200),
  desired_username TEXT NOT NULL CHECK (length(desired_username) BETWEEN 3 AND 32),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 120),
  reviewed_by TEXT REFERENCES admin_users(id),
  reviewed_at INTEGER,
  admin_id TEXT REFERENCES admin_users(id),
  demo_group TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX courier_applications_one_pending ON courier_applications(user_id) WHERE status = 'PENDING';
CREATE INDEX courier_applications_status ON courier_applications(status, created_at);
