-- © 2026 专业团队 · CampusDrop v4.5.0
-- v3.8: one payment for several parcels with any mix of sizes and destinations (多件下单), tiered 多件满减 on that
-- payment, and a shared set of test data for the one-click demo. Only adds tables, columns and triggers, rebuilds the
-- small app_settings table (to allow one more key) and replaces a few triggers with the same rules plus the new ones.
-- No order, payment or user row is deleted or rewritten.

-- ---------------------------------------------------------------- 多件下单 (checkouts)
-- A checkout is the set of orders a student paid for in one go. Inside it, parcels of the same station going to the
-- same place still become an ordinary merged delivery (order_groups); different stations or destinations become
-- separate trips. Every order keeps all of its own rules.
CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX checkouts_user ON checkouts(user_id, created_at);
ALTER TABLE delivery_orders ADD COLUMN checkout_id TEXT REFERENCES checkouts(id);
CREATE INDEX delivery_orders_checkout ON delivery_orders(checkout_id) WHERE checkout_id IS NOT NULL;
CREATE TRIGGER order_checkout_insert_guard BEFORE INSERT ON delivery_orders WHEN NEW.checkout_id IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'ORDER_CHECKOUT_INVALID') WHERE NOT EXISTS (SELECT 1 FROM checkouts c WHERE c.id = NEW.checkout_id AND c.user_id = NEW.user_id);
END;
CREATE TRIGGER order_checkout_fixed BEFORE UPDATE OF checkout_id ON delivery_orders WHEN NEW.checkout_id IS NOT OLD.checkout_id BEGIN
  SELECT RAISE(ABORT, 'ORDER_CHECKOUT_INVALID');
END;

-- ---------------------------------------------------------------- 多件满减 (bundle discount)
-- Paying two or more parcels at once and reaching a tier (default 满 15 减 2, 满 20 减 3) takes the tier off the
-- payment, split over the parcels; a coupon then applies to what is left. Like the coupon discount it is fixed once paid,
-- and a refund always returns what was actually paid for that parcel.
ALTER TABLE delivery_orders ADD COLUMN bundle_discount_fen INTEGER NOT NULL DEFAULT 0 CHECK (bundle_discount_fen >= 0);
CREATE TRIGGER bundle_discount_fixed BEFORE UPDATE OF bundle_discount_fen ON delivery_orders
WHEN OLD.status <> 'WAITING_PAYMENT' AND NEW.bundle_discount_fen IS NOT OLD.bundle_discount_fen BEGIN
  SELECT RAISE(ABORT, 'DISCOUNT_FIXED');
END;

-- The tiers are an operations setting; app_settings limits its keys, so it is rebuilt with one more allowed key.
CREATE TABLE app_settings_v38 (
  key TEXT PRIMARY KEY CHECK (key IN ('ordering_pause', 'webhook', 'shift_capacity', 'bundle_discount')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO app_settings_v38 (key, value_json, updated_by, updated_at) SELECT key, value_json, updated_by, updated_at FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_v38 RENAME TO app_settings;
INSERT INTO app_settings (key, value_json, updated_by) VALUES
('bundle_discount', '{"enabled":true,"tiers":[{"minFen":1500,"offFen":200},{"minFen":2000,"offFen":300}]}', 'system')
ON CONFLICT(key) DO NOTHING;

-- ---------------------------------------------------------------- one-click demo: shared test data
-- The demo's reports read a shared set of finished test deliveries, built once a day by the first demo of the day and
-- then used by every demo (instead of each demo writing thousands of rows). Those orders are marked demo_history = 1,
-- live under their own demo group and are written directly in their final state; the triggers below let exactly
-- those rows skip the live-order steps, and keep them read-only once the set is ready. Real orders never carry the mark.
CREATE TABLE demo_history_sets (
  day TEXT PRIMARY KEY CHECK (length(day) = 10),
  group_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING', 'READY', 'FAILED')),
  orders INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ready_at INTEGER
);
ALTER TABLE delivery_orders ADD COLUMN demo_history INTEGER NOT NULL DEFAULT 0 CHECK (demo_history IN (0, 1));
CREATE TRIGGER demo_history_insert_guard BEFORE INSERT ON delivery_orders WHEN NEW.demo_history = 1 BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_INVALID') WHERE NEW.demo_group IS NULL
    OR NOT EXISTS (SELECT 1 FROM demo_history_sets h WHERE h.group_id = NEW.demo_group AND h.status = 'BUILDING');
END;
CREATE TRIGGER demo_history_readonly BEFORE UPDATE ON delivery_orders WHEN OLD.demo_history = 1 BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
-- Nothing can be added to a ready test order (refunds, hand-backs, chat, photos, after-sales replies).
CREATE TRIGGER demo_history_adjustment BEFORE INSERT ON order_adjustments WHEN EXISTS (SELECT 1 FROM delivery_orders o
  JOIN demo_history_sets h ON h.group_id = o.demo_group WHERE o.id = NEW.order_id AND o.demo_history = 1 AND h.status <> 'BUILDING') BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
CREATE TRIGGER demo_history_release BEFORE INSERT ON order_releases WHEN EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1) BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
CREATE TRIGGER demo_history_chat BEFORE INSERT ON order_messages WHEN EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1) BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
CREATE TRIGGER demo_history_photo BEFORE INSERT ON delivery_photos WHEN EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1) BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
CREATE TRIGGER demo_history_ticket_reply BEFORE INSERT ON ticket_messages WHEN EXISTS (SELECT 1 FROM support_tickets t JOIN delivery_orders o ON o.id = t.order_id
  JOIN demo_history_sets h ON h.group_id = o.demo_group WHERE t.id = NEW.ticket_id AND o.demo_history = 1 AND h.status <> 'BUILDING') BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;
CREATE TRIGGER demo_history_ticket_state BEFORE UPDATE ON support_tickets WHEN EXISTS (SELECT 1 FROM delivery_orders o
  JOIN demo_history_sets h ON h.group_id = o.demo_group WHERE o.id = OLD.order_id AND o.demo_history = 1 AND h.status <> 'BUILDING') BEGIN
  SELECT RAISE(ABORT, 'DEMO_HISTORY_READONLY');
END;

-- Same rules as before, plus: the payment is the price minus coupon and bundle discounts; a test order (written in its
-- final state) may carry its payment without the live step.
DROP TRIGGER IF EXISTS payment_guard;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_ORDER_INVALID') WHERE NEW.type = 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id
    AND (status = 'WAITING_PAYMENT' OR demo_history = 1) AND amount_fen - discount_fen - bundle_discount_fen = NEW.amount_fen);
  SELECT RAISE(ABORT, 'TIP_ORDER_INVALID') WHERE NEW.type = 'TIP' AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND status = 'COMPLETED');
END;
DROP TRIGGER IF EXISTS mock_payment_success;
CREATE TRIGGER mock_payment_success AFTER INSERT ON payments
WHEN NEW.type = 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1) BEGIN
  UPDATE delivery_orders SET status = 'WAITING_PICKUP', version = version + 1, updated_at = unixepoch(), last_actor_type = 'STUDENT', last_actor_id = user_id WHERE id = NEW.order_id;
END;
DROP TRIGGER IF EXISTS order_initial_event;
CREATE TRIGGER order_initial_event AFTER INSERT ON delivery_orders WHEN NEW.demo_history = 0 BEGIN
  INSERT INTO order_events (order_id, to_status, actor_type, actor_id) VALUES (NEW.id, NEW.status, NEW.last_actor_type, NEW.last_actor_id);
END;
DROP TRIGGER IF EXISTS batch_item_guard;
CREATE TRIGGER batch_item_guard BEFORE INSERT ON batch_items BEGIN
  SELECT RAISE(ABORT, 'BATCH_ORDER_INVALID') WHERE NOT EXISTS (SELECT 1 FROM delivery_orders o JOIN delivery_batches b ON b.id = NEW.batch_id JOIN admin_users a ON a.id = b.assignee_admin_id
    WHERE o.id = NEW.order_id AND ((o.status = 'WAITING_PICKUP' AND a.status = 'ACTIVE') OR o.demo_history = 1) AND o.station_code = b.station_code);
END;
DROP TRIGGER IF EXISTS claim_notice;
CREATE TRIGGER claim_notice AFTER INSERT ON batch_items WHEN NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1) BEGIN
  UPDATE delivery_orders SET service_notice = '已有配送员接单，可通过下方电话联系。' WHERE id = NEW.order_id;
END;
DROP TRIGGER IF EXISTS notify_claim;
CREATE TRIGGER notify_claim AFTER INSERT ON batch_items
 WHEN NOT EXISTS (SELECT 1 FROM delivery_orders WHERE id = NEW.order_id AND demo_history = 1)
  AND NOT EXISTS (SELECT 1 FROM delivery_orders o JOIN delivery_orders s ON s.group_id = o.group_id AND s.id <> o.id JOIN batch_items bi ON bi.order_id = s.id
   WHERE o.id = NEW.order_id AND o.group_id IS NOT NULL) BEGIN
 INSERT INTO inbox_messages (user_id, order_id, kind, title) SELECT user_id, id, 'CLAIMED',
  COALESCE(json_extract(dorm_snapshot_json, '$.buildingName'), '你的订单') || IIF(group_id IS NULL, '', ' · 合并配送') || ' · 配送员已接单，可查看联系电话' FROM delivery_orders WHERE id = NEW.order_id;
END;
