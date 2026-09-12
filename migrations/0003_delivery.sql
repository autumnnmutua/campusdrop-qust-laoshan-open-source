ALTER TABLE admin_users ADD COLUMN development_only INTEGER NOT NULL DEFAULT 0 CHECK (development_only IN (0,1));
CREATE TABLE parcels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pickup_code TEXT NOT NULL,
  station_code TEXT NOT NULL REFERENCES stations(code),
  size TEXT NOT NULL CHECK (size IN ('SMALL','LARGE')),
  carrier TEXT,
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 120),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED','CANCELLED')),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX parcel_active_code ON parcels(user_id,station_code,pickup_code) WHERE status='ACTIVE';
CREATE INDEX parcel_owner_date ON parcels(user_id,created_at);
CREATE TABLE delivery_orders (
  id TEXT PRIMARY KEY,
  parcel_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  zone TEXT NOT NULL CHECK(zone IN ('SOUTH','NORTH')),
  dorm_building_code TEXT NOT NULL REFERENCES dorm_buildings(code),
  station_code TEXT NOT NULL REFERENCES stations(code),
  package_size TEXT NOT NULL CHECK(package_size IN ('SMALL','LARGE')),
  delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('DOWNSTAIRS','ROOM')),
  amount_fen INTEGER NOT NULL CHECK(amount_fen = CASE WHEN package_size='SMALL' THEN CASE WHEN delivery_mode='ROOM' THEN 300 ELSE 200 END ELSE CASE WHEN delivery_mode='ROOM' THEN 700 ELSE 500 END END ),
  price_snapshot_json TEXT NOT NULL CHECK(json_valid(price_snapshot_json)),
  dorm_snapshot_json TEXT NOT NULL CHECK(json_valid(dorm_snapshot_json)),
  station_snapshot_json TEXT NOT NULL CHECK(json_valid(station_snapshot_json)),
  status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK(status IN ('WAITING_PAYMENT','WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED','CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION')),
  version INTEGER NOT NULL DEFAULT 0,
  last_actor_type TEXT NOT NULL CHECK(last_actor_type IN ('STUDENT','ADMIN','SYSTEM')),
  last_actor_id TEXT NOT NULL,
  exception_code TEXT CHECK(exception_code IS NULL OR exception_code IN ('CODE_INVALID','SIZE_MISMATCH','UNREACHABLE','OTHER')),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT(unixepoch()),
  FOREIGN KEY(parcel_id,user_id) REFERENCES parcels(id,user_id)
);
CREATE UNIQUE INDEX one_active_order ON delivery_orders(parcel_id) WHERE status <> 'CANCELLED';
CREATE INDEX order_task_pool ON delivery_orders(status,dorm_building_code,created_at);
CREATE INDEX order_owner_date ON delivery_orders(user_id,created_at);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES delivery_orders(id),
  type TEXT NOT NULL CHECK(type IN ('DELIVERY','TIP')),
  provider TEXT NOT NULL CHECK(provider='MOCK'),
  amount_fen INTEGER NOT NULL CHECK(amount_fen BETWEEN 1 AND 10000),
  status TEXT NOT NULL CHECK(status='SUCCEEDED'),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  UNIQUE(order_id,type,idempotency_key)
);
CREATE UNIQUE INDEX one_delivery_payment ON payments(order_id) WHERE type='DELIVERY';
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES delivery_orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX order_event_timeline ON order_events(order_id,id);
CREATE TABLE delivery_batches (
  id TEXT PRIMARY KEY,
  station_code TEXT NOT NULL REFERENCES stations(code),
  assignee_admin_id TEXT NOT NULL REFERENCES admin_users(id),
  created_by TEXT NOT NULL REFERENCES admin_users(id),
  created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX batch_assignee ON delivery_batches(assignee_admin_id,created_at);
CREATE TABLE batch_items (
  batch_id TEXT NOT NULL REFERENCES delivery_batches(id),
  order_id TEXT NOT NULL UNIQUE REFERENCES delivery_orders(id),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY(batch_id,order_id)
);
CREATE TRIGGER order_initial_event AFTER INSERT ON delivery_orders BEGIN
  INSERT INTO order_events(order_id,to_status,actor_type,actor_id) VALUES(NEW.id,NEW.status,NEW.last_actor_type,NEW.last_actor_id);
END;
CREATE TRIGGER order_snapshot_immutable BEFORE UPDATE OF parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,price_snapshot_json,dorm_snapshot_json,station_snapshot_json ON delivery_orders BEGIN
  SELECT RAISE(ABORT,'ORDER_SNAPSHOT_IMMUTABLE');
END;
CREATE TRIGGER order_transition_guard BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
  SELECT RAISE(ABORT,'INVALID_TRANSITION') WHERE NOT (
    (OLD.status='WAITING_PAYMENT' AND NEW.status='WAITING_PICKUP' AND EXISTS(SELECT 1 FROM payments WHERE order_id=OLD.id AND type='DELIVERY')) OR
    (OLD.status='WAITING_PAYMENT' AND NEW.status='CANCELLED') OR
    (OLD.status='WAITING_PICKUP' AND NEW.status IN ('PICKED_UP','FAILED_PICKUP','CANCELLED')) OR
    (OLD.status='PICKED_UP' AND NEW.status IN ('OUT_FOR_DELIVERY','DELIVERY_EXCEPTION')) OR
    (OLD.status='OUT_FOR_DELIVERY' AND (NEW.status='DELIVERY_EXCEPTION' OR (NEW.status='DELIVERED_DOWNSTAIRS' AND OLD.delivery_mode='DOWNSTAIRS') OR (NEW.status='DELIVERED_TO_ROOM' AND OLD.delivery_mode='ROOM'))) OR
    (OLD.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM') AND NEW.status='COMPLETED') OR
    (OLD.status='FAILED_PICKUP' AND NEW.status IN ('WAITING_PICKUP','CANCELLED')) OR
    (OLD.status='DELIVERY_EXCEPTION' AND NEW.status IN ('OUT_FOR_DELIVERY','CANCELLED'))
  );
END;
CREATE TRIGGER order_status_event AFTER UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
  INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id) VALUES(NEW.id,OLD.status,NEW.status,NEW.last_actor_type,NEW.last_actor_id);
  INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(lower(hex(randomblob(16))),NEW.last_actor_type,NEW.last_actor_id,'ORDER_STATUS_CHANGED',NEW.id,json_object('from',OLD.status,'to',NEW.status,'exceptionCode',NEW.exception_code));
  UPDATE parcels SET status='CLOSED' WHERE id=NEW.parcel_id AND NEW.status='COMPLETED';
END;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
  SELECT RAISE(ABORT,'PAYMENT_ORDER_INVALID') WHERE NEW.type='DELIVERY' AND NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='WAITING_PAYMENT' AND amount_fen=NEW.amount_fen);
  SELECT RAISE(ABORT,'TIP_ORDER_INVALID') WHERE NEW.type='TIP' AND NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='COMPLETED');
END;
CREATE TRIGGER mock_payment_success AFTER INSERT ON payments WHEN NEW.type='DELIVERY' BEGIN
  UPDATE delivery_orders SET status='WAITING_PICKUP',version=version+1,updated_at=unixepoch(),last_actor_type='STUDENT',last_actor_id=user_id WHERE id=NEW.order_id;
END;
CREATE TRIGGER batch_item_guard BEFORE INSERT ON batch_items BEGIN
  SELECT RAISE(ABORT,'BATCH_ORDER_INVALID') WHERE NOT EXISTS(SELECT 1 FROM delivery_orders o JOIN delivery_batches b ON b.id=NEW.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id
    WHERE o.id=NEW.order_id AND o.status='WAITING_PICKUP' AND o.station_code=b.station_code AND a.status='ACTIVE');
END;
