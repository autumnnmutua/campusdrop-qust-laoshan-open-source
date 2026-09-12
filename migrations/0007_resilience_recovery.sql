ALTER TABLE parcel_handoffs ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0 CHECK(rejected IN (0,1));
ALTER TABLE parcel_handoffs ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '' CHECK(length(rejection_reason)<=240);
ALTER TABLE parcel_handoffs ADD COLUMN reviewed_by TEXT;
ALTER TABLE parcel_handoffs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE handoff_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, handoff_id TEXT NOT NULL REFERENCES parcel_handoffs(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('EDIT','REJECT')),
 prior_location TEXT NOT NULL,prior_note TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
DROP INDEX handoff_pending;
CREATE UNIQUE INDEX handoff_pending ON parcel_handoffs(order_id) WHERE status='PENDING' AND rejected=0;
DROP TRIGGER handoff_pending_blocks_progress;
CREATE TRIGGER handoff_pending_blocks_progress BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status AND EXISTS(SELECT 1 FROM parcel_handoffs WHERE order_id=OLD.id AND status='PENDING' AND rejected=0) BEGIN
 SELECT RAISE(ABORT,'HANDOFF_PENDING');
END;
DROP TRIGGER handoff_confirm_guard;
CREATE TRIGGER handoff_confirm_guard BEFORE UPDATE OF status ON parcel_handoffs WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'HANDOFF_INVALID') WHERE OLD.rejected=1 OR OLD.status<>'PENDING' OR NEW.status<>'CONFIRMED' OR NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='DELIVERY_EXCEPTION' AND custody_state='STAFF');
END;
CREATE TRIGGER handoff_change_guard BEFORE UPDATE OF location,note,rejected ON parcel_handoffs BEGIN
 SELECT RAISE(ABORT,'HANDOFF_INVALID') WHERE OLD.status<>'PENDING' OR OLD.rejected=1 OR NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=OLD.order_id AND status='DELIVERY_EXCEPTION' AND custody_state='STAFF');
END;
CREATE TRIGGER handoff_change_event AFTER UPDATE OF location,note,rejected ON parcel_handoffs BEGIN
 INSERT INTO handoff_changes(handoff_id,actor_id,action,prior_location,prior_note,reason) VALUES(NEW.id,COALESCE(NEW.reviewed_by,NEW.requested_by),IIF(NEW.rejected=1,'REJECT','EDIT'),OLD.location,OLD.note,NEW.rejection_reason);
 UPDATE delivery_orders SET version=version+1,updated_at=unixepoch(),service_notice=IIF(NEW.rejected=1,'归还交接被驳回，请配送员核对后重新提交。','交接说明已修改，等待管理员重新核验。') WHERE id=NEW.order_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'ADMIN',COALESCE(NEW.reviewed_by,NEW.requested_by),IIF(NEW.rejected=1,'HANDOFF_REJECTED','HANDOFF_EDITED'),NEW.order_id);
END;
CREATE INDEX orders_owner_cursor ON delivery_orders(user_id,student_deleted,created_at DESC,id DESC);
CREATE INDEX orders_market_cursor ON delivery_orders(status,student_deleted,created_at,id);
CREATE INDEX orders_scope_cursor ON delivery_orders(campus_id,zone,dorm_building_code,created_at DESC,id DESC);
CREATE INDEX parcels_owner_cursor ON parcels(user_id,created_at DESC,id DESC);
CREATE TABLE recovery_tokens (
 token_hash TEXT PRIMARY KEY,actor_kind TEXT NOT NULL CHECK(actor_kind IN ('student','admin')),actor_id TEXT NOT NULL,
 issued_by TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,replacement_hash TEXT,
 UNIQUE(actor_kind,actor_id)
);
CREATE TRIGGER recovery_apply AFTER UPDATE OF used_at ON recovery_tokens WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'RECOVERY_INVALID') WHERE OLD.expires_at<=unixepoch() OR NEW.replacement_hash IS NULL;
 UPDATE users SET password_hash=NEW.replacement_hash WHERE id=NEW.actor_id AND NEW.actor_kind='student' AND status='ACTIVE';
 UPDATE admin_users SET password_hash=NEW.replacement_hash WHERE id=NEW.actor_id AND NEW.actor_kind='admin' AND status='ACTIVE';
 DELETE FROM sessions WHERE (NEW.actor_kind='student' AND user_id=NEW.actor_id) OR (NEW.actor_kind='admin' AND admin_id=NEW.actor_id);
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'SYSTEM',NEW.actor_id,'ACCOUNT_RECOVERED',NEW.actor_id);
 UPDATE recovery_tokens SET replacement_hash=NULL WHERE token_hash=NEW.token_hash;
END;
CREATE TABLE error_events (
 request_id TEXT PRIMARY KEY,route TEXT NOT NULL,method TEXT NOT NULL,category TEXT NOT NULL,http_status INTEGER NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX errors_date ON error_events(created_at DESC,request_id DESC);
