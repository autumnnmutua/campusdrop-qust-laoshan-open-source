-- Prevent an account deletion and another in-flight request from creating contradictory or private records.
-- The checks run inside the same SQLite transaction as the write, including D1 batch transactions.
CREATE TRIGGER account_deletion_active_work BEFORE UPDATE OF deleted_at ON users
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_HAS_ORDERS') WHERE EXISTS (
    SELECT 1 FROM delivery_orders WHERE user_id=OLD.id AND status NOT IN ('COMPLETED','CANCELLED') AND student_deleted=0
  ) OR EXISTS (
    SELECT 1 FROM send_requests WHERE user_id=OLD.id AND status IN ('WAITING_PICKUP','PICKED_UP')
  );
END;

CREATE TRIGGER account_deletion_once BEFORE UPDATE OF deleted_at ON users
WHEN OLD.deleted_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER deleted_user_profile_guard BEFORE UPDATE OF name,phone ON users
WHEN OLD.deleted_at IS NOT NULL AND (NEW.name IS NOT OLD.name OR NEW.phone IS NOT OLD.phone) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

CREATE TRIGGER deleted_user_send_guard BEFORE INSERT ON send_requests
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_order_guard BEFORE INSERT ON delivery_orders
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_checkout_guard BEFORE INSERT ON checkouts
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_order_group_guard BEFORE INSERT ON order_groups
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_parcel_guard BEFORE INSERT ON parcels
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_address_guard BEFORE INSERT ON user_addresses
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_application_guard BEFORE INSERT ON courier_applications
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_rule_guard BEFORE INSERT ON delivery_rules
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_support_guard BEFORE INSERT ON support_tickets
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_ticket_message_guard BEFORE INSERT ON ticket_messages
WHEN EXISTS (SELECT 1 FROM support_tickets t JOIN users u ON u.id=t.user_id
  WHERE t.id=NEW.ticket_id AND u.deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_order_message_guard BEFORE INSERT ON order_messages
WHEN EXISTS (SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id
  WHERE o.id=NEW.order_id AND u.deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;

-- Notifications are optional side effects, including those produced by other triggers while
-- deleting an account. Skip them without interrupting the enclosing business transaction.
CREATE TRIGGER deleted_user_inbox_guard BEFORE INSERT ON inbox_messages
WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(IGNORE);
END;
CREATE TRIGGER deleted_user_push_insert_guard BEFORE INSERT ON push_subscriptions
WHEN NEW.owner_kind='STUDENT' AND EXISTS (SELECT 1 FROM users WHERE id=NEW.owner_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_push_update_guard BEFORE UPDATE ON push_subscriptions
WHEN NEW.owner_kind='STUDENT' AND EXISTS (SELECT 1 FROM users WHERE id=NEW.owner_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_DELETED');
END;
