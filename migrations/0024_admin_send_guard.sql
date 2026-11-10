-- Prevent a courier from being disabled while an assigned send is still active.
-- The trigger closes the race between the API pre-check and the account update.
CREATE TRIGGER admin_active_send_guard BEFORE UPDATE OF status ON admin_users
WHEN OLD.status='ACTIVE' AND NEW.status='DISABLED' AND EXISTS (
  SELECT 1 FROM send_requests WHERE assignee_admin_id=OLD.id AND status IN ('WAITING_PICKUP','PICKED_UP')
) BEGIN
  SELECT RAISE(ABORT, 'ADMIN_HAS_TASKS');
END;

-- Keep building assignments intact until an operator explicitly hands them over.
-- These checks run in the same transaction as an account update, including when
-- a building is assigned between the API's initial read and its write.
CREATE TRIGGER admin_assigned_building_disable_guard BEFORE UPDATE OF status ON admin_users
WHEN OLD.status='ACTIVE' AND NEW.status='DISABLED' AND EXISTS (
  SELECT 1 FROM building_couriers WHERE admin_id=OLD.id
) BEGIN
  SELECT RAISE(ABORT, 'ADMIN_HAS_BUILDINGS');
END;

CREATE TRIGGER admin_assigned_building_role_guard BEFORE UPDATE OF role ON admin_users
WHEN NEW.role NOT IN ('DELIVERY_STAFF','SUPER_ADMIN') AND NEW.role IS NOT OLD.role AND EXISTS (
  SELECT 1 FROM building_couriers WHERE admin_id=OLD.id
) BEGIN
  SELECT RAISE(ABORT, 'ADMIN_HAS_BUILDINGS');
END;
