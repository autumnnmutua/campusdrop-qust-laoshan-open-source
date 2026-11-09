-- © 2026 专业团队 · CampusDrop v4.5.0
-- v3.9: the platform takes 0.20 元 per delivered parcel (配送 and 代寄件); couriers get the rest of the fee plus all tips
-- in a wallet they can withdraw to WeChat, Alipay or a bank card (simulated, like every payment on the site).
-- Only adds tables, one column and triggers; nothing is deleted or rewritten.

-- ---------------------------------------------------------------- courier wallet: an append-only ledger
-- One row per credit or debit; the balance is the sum. Credits are written by triggers the moment a delivery is
-- completed (signed for), a send request is dropped at the station, or a tip is paid — so they can never be missed
-- or counted twice (UNIQUE kind + ref). A withdrawal request writes a debit at once; a rejected one is returned.
CREATE TABLE courier_ledger (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  kind TEXT NOT NULL CHECK (kind IN ('DELIVERY', 'SEND', 'TIP', 'WITHDRAW', 'WITHDRAW_RETURN')),
  ref_id TEXT NOT NULL,
  gross_fen INTEGER NOT NULL DEFAULT 0,
  fee_fen INTEGER NOT NULL DEFAULT 0 CHECK (fee_fen >= 0),
  amount_fen INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (kind, ref_id),
  CHECK ((kind IN ('WITHDRAW') AND amount_fen < 0) OR (kind NOT IN ('WITHDRAW') AND amount_fen >= 0))
);
CREATE INDEX courier_ledger_admin ON courier_ledger(admin_id, created_at);
CREATE TRIGGER courier_ledger_append_only BEFORE UPDATE ON courier_ledger BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE');
END;

-- Delivery: fee paid by the student at full price (coupons and 满减 are borne by the platform), minus 0.20 元.
CREATE TRIGGER courier_earn_delivery AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' AND NEW.demo_history = 0 BEGIN
  INSERT OR IGNORE INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  SELECT lower(hex(randomblob(16))), b.assignee_admin_id, 'DELIVERY', NEW.id,
    NEW.amount_fen + NEW.delivery_upgrade_fen + NEW.upgrade_surcharge_fen, 20,
    NEW.amount_fen + NEW.delivery_upgrade_fen + NEW.upgrade_surcharge_fen - 20, coalesce(NEW.received_at, unixepoch())
  FROM batch_items bi JOIN delivery_batches b ON b.id = bi.batch_id WHERE bi.order_id = NEW.id;
END;
-- 代寄件: the send fee minus 0.20 元 once the parcel is dropped at the station.
CREATE TRIGGER courier_earn_send AFTER UPDATE OF status ON send_requests
WHEN NEW.status = 'DROPPED' AND OLD.status <> 'DROPPED' AND NEW.assignee_admin_id IS NOT NULL BEGIN
  INSERT OR IGNORE INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.assignee_admin_id, 'SEND', NEW.id, NEW.amount_fen, 20, NEW.amount_fen - 20, coalesce(NEW.dropped_at, unixepoch()));
END;
-- Tips go to the courier in full.
CREATE TRIGGER courier_earn_tip AFTER INSERT ON payments WHEN NEW.type = 'TIP' BEGIN
  INSERT OR IGNORE INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  SELECT lower(hex(randomblob(16))), b.assignee_admin_id, 'TIP', NEW.id, NEW.amount_fen, 0, NEW.amount_fen, NEW.created_at
  FROM batch_items bi JOIN delivery_batches b ON b.id = bi.batch_id JOIN delivery_orders o ON o.id = bi.order_id
  WHERE bi.order_id = NEW.order_id AND o.demo_history = 0;
END;

-- ---------------------------------------------------------------- payout accounts and withdrawals (simulated)
-- Only a masked account and the last four digits are kept: nothing is ever sent to a real payment service.
CREATE TABLE courier_payout_accounts (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  method TEXT NOT NULL CHECK (method IN ('WECHAT', 'ALIPAY', 'BANK')),
  account_name TEXT NOT NULL CHECK (length(account_name) BETWEEN 1 AND 20),
  account_masked TEXT NOT NULL CHECK (length(account_masked) BETWEEN 2 AND 40),
  account_last4 TEXT NOT NULL CHECK (length(account_last4) BETWEEN 1 AND 4),
  bank_name TEXT CHECK (bank_name IS NULL OR length(bank_name) BETWEEN 2 AND 20),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  removed_at INTEGER,
  CHECK ((method = 'BANK') = (bank_name IS NOT NULL))
);
CREATE INDEX courier_payout_accounts_admin ON courier_payout_accounts(admin_id) WHERE removed_at IS NULL;

CREATE TABLE courier_withdrawals (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  account_id TEXT NOT NULL REFERENCES courier_payout_accounts(id),
  method TEXT NOT NULL CHECK (method IN ('WECHAT', 'ALIPAY', 'BANK')),
  account_label TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK (amount_fen BETWEEN 100 AND 500000),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'REJECTED')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 120),
  reviewed_by TEXT REFERENCES admin_users(id),
  reviewed_at INTEGER,
  paid_ref TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX courier_withdrawals_admin ON courier_withdrawals(admin_id, created_at);
CREATE INDEX courier_withdrawals_status ON courier_withdrawals(status, created_at);
-- A withdrawal can never exceed the balance (checked inside the same write, so two requests cannot both pass).
CREATE TRIGGER courier_withdraw_guard BEFORE INSERT ON courier_withdrawals BEGIN
  SELECT RAISE(ABORT, 'WITHDRAW_EXCEEDS_BALANCE') WHERE coalesce((SELECT sum(amount_fen) FROM courier_ledger WHERE admin_id = NEW.admin_id), 0) < NEW.amount_fen;
  SELECT RAISE(ABORT, 'WITHDRAW_ACCOUNT_INVALID') WHERE NOT EXISTS (SELECT 1 FROM courier_payout_accounts a WHERE a.id = NEW.account_id AND a.admin_id = NEW.admin_id AND a.removed_at IS NULL);
END;
CREATE TRIGGER courier_withdraw_debit AFTER INSERT ON courier_withdrawals BEGIN
  INSERT INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.admin_id, 'WITHDRAW', NEW.id, NEW.amount_fen, 0, -NEW.amount_fen, NEW.created_at);
END;
CREATE TRIGGER courier_withdraw_review BEFORE UPDATE OF status ON courier_withdrawals WHEN NEW.status IS NOT OLD.status BEGIN
  SELECT RAISE(ABORT, 'WITHDRAW_ALREADY_REVIEWED') WHERE OLD.status <> 'PENDING' OR NEW.status NOT IN ('PAID', 'REJECTED');
END;
CREATE TRIGGER courier_withdraw_return AFTER UPDATE OF status ON courier_withdrawals WHEN NEW.status = 'REJECTED' AND OLD.status = 'PENDING' BEGIN
  INSERT INTO courier_ledger (id, admin_id, kind, ref_id, gross_fen, fee_fen, amount_fen, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.admin_id, 'WITHDRAW_RETURN', NEW.id, NEW.amount_fen, 0, NEW.amount_fen, coalesce(NEW.reviewed_at, unixepoch()));
END;

-- ---------------------------------------------------------------- sample data marker
-- Orders marked as starting examples (seed_data = 1) are left out of 实测报告, so the
-- report only ever counts what real people did after the trial started.
ALTER TABLE delivery_orders ADD COLUMN seed_data INTEGER NOT NULL DEFAULT 0 CHECK (seed_data IN (0, 1));
