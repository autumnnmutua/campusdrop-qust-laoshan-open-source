-- © 2026 专业团队 · CampusDrop v4.0.0
-- v3.7.1: coupons (优惠券 / 优惠码) for the delivery fee. Adds three tables, two nullable-safe columns on
-- delivery_orders (existing orders keep discount 0), replaces the payment guard so a discounted order can be paid,
-- and seeds the new-account 50%-off coupon plus a few public codes. Nothing is deleted.
--
-- scope PERSONAL: issued to accounts (coupon_grants), used without a code; PUBLIC: anyone who types the code
-- (or everyone, when auto_apply = 1). Every account can use a coupon once (one USED redemption per coupon and
-- account); total_limit caps the uses across all accounts (1 = only the first account that uses it).
-- discount_type RATE: value is the share still paid, in percent (50 = 五折, 85 = 八五折); AMOUNT: value is fen off.
CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  code TEXT CHECK (code IS NULL OR (length(code) BETWEEN 3 AND 20 AND code NOT GLOB '*[^A-Z0-9]*')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  scope TEXT NOT NULL CHECK (scope IN ('PERSONAL', 'PUBLIC')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('RATE', 'AMOUNT')),
  discount_value INTEGER NOT NULL CHECK ((discount_type = 'RATE' AND discount_value BETWEEN 10 AND 95) OR (discount_type = 'AMOUNT' AND discount_value BETWEEN 1 AND 5000)),
  min_spend_fen INTEGER NOT NULL DEFAULT 0 CHECK (min_spend_fen BETWEEN 0 AND 100000),
  max_discount_fen INTEGER CHECK (max_discount_fen IS NULL OR max_discount_fen BETWEEN 1 AND 100000),
  total_limit INTEGER CHECK (total_limit IS NULL OR total_limit BETWEEN 1 AND 1000000),
  auto_apply INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  grant_on_register INTEGER NOT NULL DEFAULT 0 CHECK (grant_on_register IN (0, 1)),
  valid_days INTEGER CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 366),
  starts_at INTEGER,
  ends_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  demo_group TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((scope = 'PUBLIC' AND code IS NOT NULL) OR (scope = 'PERSONAL' AND code IS NULL AND auto_apply = 0)),
  CHECK (grant_on_register = 0 OR scope = 'PERSONAL'),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
-- A code is unique among real coupons, and within each one-click demo.
CREATE UNIQUE INDEX coupon_code ON coupons(coalesce(demo_group, ''), code) WHERE code IS NOT NULL;
CREATE INDEX coupon_register ON coupons(grant_on_register, status) WHERE grant_on_register = 1;

CREATE TABLE coupon_grants (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  UNIQUE (coupon_id, user_id)
);
CREATE INDEX coupon_grants_user ON coupon_grants(user_id);

CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  discount_fen INTEGER NOT NULL CHECK (discount_fen > 0),
  status TEXT NOT NULL DEFAULT 'USED' CHECK (status IN ('USED', 'RELEASED')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  released_at INTEGER
);
-- Each account uses a coupon at most once (a released use — order cancelled — frees it again).
CREATE UNIQUE INDEX coupon_once_per_account ON coupon_redemptions(coupon_id, user_id) WHERE status = 'USED';
CREATE INDEX coupon_redemptions_coupon ON coupon_redemptions(coupon_id, status);

ALTER TABLE delivery_orders ADD COLUMN discount_fen INTEGER NOT NULL DEFAULT 0 CHECK (discount_fen >= 0);
ALTER TABLE delivery_orders ADD COLUMN coupon_redemption_id TEXT;

-- The delivery payment is the price minus the discount (still at least 0.01 元: payments.amount_fen >= 1).
DROP TRIGGER IF EXISTS payment_guard;
CREATE TRIGGER payment_guard BEFORE INSERT ON payments BEGIN
  SELECT RAISE(ABORT,'PAYMENT_ORDER_INVALID') WHERE NEW.type='DELIVERY' AND NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='WAITING_PAYMENT' AND amount_fen-discount_fen=NEW.amount_fen);
  SELECT RAISE(ABORT,'TIP_ORDER_INVALID') WHERE NEW.type='TIP' AND NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='COMPLETED');
END;
-- The discount is fixed once the order is paid.
CREATE TRIGGER discount_fixed BEFORE UPDATE OF discount_fen, coupon_redemption_id ON delivery_orders
WHEN OLD.status <> 'WAITING_PAYMENT' AND (NEW.discount_fen IS NOT OLD.discount_fen OR NEW.coupon_redemption_id IS NOT OLD.coupon_redemption_id) BEGIN
  SELECT RAISE(ABORT, 'DISCOUNT_FIXED');
END;
-- A cancelled (refunded) order gives its coupon back once every order paid with that use is cancelled.
CREATE TRIGGER coupon_release AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' AND NEW.coupon_redemption_id IS NOT NULL BEGIN
  UPDATE coupon_redemptions SET status = 'RELEASED', released_at = unixepoch()
  WHERE id = NEW.coupon_redemption_id AND status = 'USED'
    AND NOT EXISTS (SELECT 1 FROM delivery_orders WHERE coupon_redemption_id = NEW.coupon_redemption_id AND status <> 'CANCELLED');
END;

-- Starting coupons. The new-account coupon is granted at registration (valid 30 days).
INSERT INTO coupons (id, code, name, scope, discount_type, discount_value, min_spend_fen, max_discount_fen, total_limit, auto_apply, grant_on_register, valid_days) VALUES
('c0000000-0000-4000-8000-000000000001', NULL, '新人五折券', 'PERSONAL', 'RATE', 50, 0, NULL, NULL, 0, 1, 30),
('c0000000-0000-4000-8000-000000000002', 'QUST', 'QUST 校园券 · 立减 1 元', 'PUBLIC', 'AMOUNT', 100, 200, NULL, NULL, 0, 0, NULL),
('c0000000-0000-4000-8000-000000000003', 'QDKJDX', '青岛科技大学 · 八折', 'PUBLIC', 'RATE', 80, 0, 200, NULL, 0, 0, NULL),
('c0000000-0000-4000-8000-000000000004', 'LAOSHAN', '崂山校区 · 九折（限 200 次）', 'PUBLIC', 'RATE', 90, 0, NULL, 200, 0, 0, NULL),
('c0000000-0000-4000-8000-000000000005', 'FIRSTDROP', 'CampusDrop 首单 · 五折（全站仅 1 次）', 'PUBLIC', 'RATE', 50, 0, NULL, 1, 0, 0, NULL)
ON CONFLICT(id) DO NOTHING;
