-- Free-text operational records may contain student names, phone numbers or addresses.
-- Permit a deleted account's handoff text to be scrubbed without recording the old text again.
DROP TRIGGER handoff_change_guard;
CREATE TRIGGER handoff_change_guard BEFORE UPDATE OF location,note,rejected ON parcel_handoffs BEGIN
 SELECT RAISE(ABORT,'HANDOFF_INVALID') WHERE
  (EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE o.id=OLD.order_id AND u.deleted_at IS NOT NULL)
   AND (NEW.location<>'已清理' OR NEW.note<>'已清理' OR NEW.rejection_reason<>'' OR NEW.rejected IS NOT OLD.rejected))
  OR
  (NOT EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE o.id=OLD.order_id AND u.deleted_at IS NOT NULL)
   AND (OLD.status<>'PENDING' OR OLD.rejected=1 OR NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=OLD.order_id AND status='DELIVERY_EXCEPTION' AND custody_state='STAFF')));
END;
CREATE TRIGGER deleted_user_handoff_reason_guard BEFORE UPDATE OF rejection_reason ON parcel_handoffs
WHEN NEW.rejection_reason<>'' AND EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE o.id=OLD.order_id AND u.deleted_at IS NOT NULL) BEGIN
 SELECT RAISE(ABORT,'ACCOUNT_DELETED');
END;
DROP TRIGGER handoff_change_event;
CREATE TRIGGER handoff_change_event AFTER UPDATE OF location,note,rejected ON parcel_handoffs
WHEN NOT EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE o.id=NEW.order_id AND u.deleted_at IS NOT NULL) BEGIN
 INSERT INTO handoff_changes(handoff_id,actor_id,action,prior_location,prior_note,reason) VALUES(NEW.id,COALESCE(NEW.reviewed_by,NEW.requested_by),IIF(NEW.rejected=1,'REJECT','EDIT'),OLD.location,OLD.note,NEW.rejection_reason);
 UPDATE delivery_orders SET version=version+1,updated_at=unixepoch(),service_notice=IIF(NEW.rejected=1,'归还交接被驳回，请配送员核对后重新提交。','交接说明已修改，等待管理员重新核验。') WHERE id=NEW.order_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'ADMIN',COALESCE(NEW.reviewed_by,NEW.requested_by),IIF(NEW.rejected=1,'HANDOFF_REJECTED','HANDOFF_EDITED'),NEW.order_id);
END;

-- Repair records of accounts deleted before this migration. Statuses and financial records remain intact.
UPDATE delivery_orders SET exception_note='',service_notice='' WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
UPDATE send_requests SET cancel_reason='' WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
UPDATE order_events SET detail='' WHERE order_id IN (SELECT o.id FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE u.deleted_at IS NOT NULL);
UPDATE order_releases SET reason='已清理' WHERE order_id IN (SELECT o.id FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE u.deleted_at IS NOT NULL);
UPDATE parcel_handoffs SET location='已清理',note='已清理',rejection_reason='' WHERE order_id IN (SELECT o.id FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE u.deleted_at IS NOT NULL);
UPDATE handoff_changes SET prior_location='',prior_note='',reason='' WHERE handoff_id IN (SELECT h.id FROM parcel_handoffs h JOIN delivery_orders o ON o.id=h.order_id JOIN users u ON u.id=o.user_id WHERE u.deleted_at IS NOT NULL);
UPDATE order_ratings SET comment='' WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);

-- Ratings may race with account deletion after the request has already been authenticated.
CREATE TRIGGER deleted_user_rating_insert_guard BEFORE INSERT ON order_ratings
WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_rating_comment_guard BEFORE UPDATE OF comment ON order_ratings
WHEN NEW.comment<>'' AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'ACCOUNT_DELETED');
END;

-- A courier may upload a photo to a completed order while its student deletes the account.
-- Check inside the same transaction as the write, including both an insert and an upsert update.
CREATE TRIGGER deleted_user_photo_insert_guard BEFORE INSERT ON delivery_photos
WHEN EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id
  WHERE o.id=NEW.order_id AND u.deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'ACCOUNT_DELETED');
END;
CREATE TRIGGER deleted_user_photo_update_guard BEFORE UPDATE ON delivery_photos
WHEN EXISTS(SELECT 1 FROM delivery_orders o JOIN users u ON u.id=o.user_id
  WHERE o.id=NEW.order_id AND u.deleted_at IS NOT NULL) BEGIN
  SELECT RAISE(ABORT,'ACCOUNT_DELETED');
END;
-- Remove photos recreated after a previous deletion before these guards existed.
DELETE FROM delivery_photos WHERE order_id IN (
  SELECT o.id FROM delivery_orders o JOIN users u ON u.id=o.user_id WHERE u.deleted_at IS NOT NULL
);
