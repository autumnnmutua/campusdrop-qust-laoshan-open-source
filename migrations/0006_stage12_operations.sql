-- Existing paid upgrades retain their original amount; the extra large-parcel surcharge applies only to new upgrades.
ALTER TABLE delivery_orders ADD COLUMN upgrade_surcharge_fen INTEGER NOT NULL DEFAULT 0 CHECK(upgrade_surcharge_fen IN (0,100));
ALTER TABLE delivery_orders ADD COLUMN student_cancelled INTEGER NOT NULL DEFAULT 0 CHECK(student_cancelled IN (0,1));
ALTER TABLE delivery_orders ADD COLUMN custody_state TEXT NOT NULL DEFAULT 'NONE' CHECK(custody_state IN ('NONE','STAFF','RETURNED','DELIVERED'));
ALTER TABLE users ADD COLUMN test_account INTEGER NOT NULL DEFAULT 0 CHECK(test_account IN (0,1));
ALTER TABLE admin_users ADD COLUMN test_account INTEGER NOT NULL DEFAULT 0 CHECK(test_account IN (0,1));
UPDATE delivery_orders SET custody_state=CASE WHEN status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') THEN 'DELIVERED' ELSE 'STAFF' END
 WHERE status IN ('PICKED_UP','OUT_FOR_DELIVERY','DELIVERY_EXCEPTION','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
CREATE TABLE parcel_handoffs (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL,
 station_code TEXT NOT NULL REFERENCES stations(code),
 location TEXT NOT NULL CHECK(length(location) BETWEEN 1 AND 120),
 note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 240),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED')),
 confirmed_by TEXT,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 confirmed_at INTEGER,
 CHECK((status='PENDING' AND confirmed_by IS NULL AND confirmed_at IS NULL) OR (status='CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_by<>requested_by AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX handoff_pending ON parcel_handoffs(order_id) WHERE status='PENDING';
CREATE TRIGGER handoff_request_guard BEFORE INSERT ON parcel_handoffs BEGIN
 SELECT RAISE(ABORT,'HANDOFF_INVALID') WHERE NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='DELIVERY_EXCEPTION' AND custody_state='STAFF' AND student_deleted=0 AND station_code=NEW.station_code);
END;
CREATE TRIGGER handoff_requested AFTER INSERT ON parcel_handoffs BEGIN
 UPDATE delivery_orders SET version=version+1,updated_at=unixepoch() WHERE id=NEW.order_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'ADMIN',NEW.requested_by,'HANDOFF_REQUESTED',NEW.order_id);
END;
CREATE TRIGGER handoff_confirm_guard BEFORE UPDATE OF status ON parcel_handoffs WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'HANDOFF_INVALID') WHERE OLD.status<>'PENDING' OR NEW.status<>'CONFIRMED' OR NOT EXISTS(SELECT 1 FROM delivery_orders WHERE id=NEW.order_id AND status='DELIVERY_EXCEPTION' AND custody_state='STAFF');
END;
CREATE TRIGGER handoff_confirmed AFTER UPDATE OF status ON parcel_handoffs WHEN OLD.status='PENDING' AND NEW.status='CONFIRMED' BEGIN
 UPDATE delivery_orders SET custody_state='RETURNED',version=version+1,updated_at=unixepoch(),service_notice='包裹已归还原站点并经管理员核验，等待退单或后续安排。' WHERE id=NEW.order_id;
 INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,detail) VALUES(NEW.order_id,'DELIVERY_EXCEPTION','DELIVERY_EXCEPTION','ADMIN',NEW.confirmed_by,'包裹归还原站点，已由另一管理员核验。');
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'ADMIN',NEW.confirmed_by,'HANDOFF_CONFIRMED',NEW.order_id);
END;
CREATE TRIGGER custody_progress AFTER UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
 UPDATE delivery_orders SET custody_state='STAFF' WHERE id=NEW.id AND NEW.status IN ('PICKED_UP','OUT_FOR_DELIVERY');
 UPDATE delivery_orders SET custody_state='DELIVERED' WHERE id=NEW.id AND NEW.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
END;
CREATE TRIGGER handoff_pending_blocks_progress BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status AND EXISTS(SELECT 1 FROM parcel_handoffs WHERE order_id=OLD.id AND status='PENDING') BEGIN
 SELECT RAISE(ABORT,'HANDOFF_PENDING');
END;
CREATE TRIGGER custody_cancellation_guard BEFORE UPDATE ON delivery_orders WHEN OLD.custody_state='STAFF' AND ((OLD.student_deleted=0 AND NEW.student_deleted=1) OR (OLD.student_cancelled=0 AND NEW.student_cancelled=1)) BEGIN
 SELECT RAISE(ABORT,'HANDOFF_REQUIRED');
END;
CREATE TRIGGER admin_active_task_guard BEFORE UPDATE OF status ON admin_users WHEN OLD.status='ACTIVE' AND NEW.status='DISABLED' BEGIN
 SELECT RAISE(ABORT,'ADMIN_HAS_TASKS') WHERE EXISTS(SELECT 1 FROM delivery_batches b JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id WHERE b.assignee_admin_id=OLD.id AND o.status NOT IN ('CANCELLED','COMPLETED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'));
END;
DROP TRIGGER adjustment_guard;
DROP TRIGGER upgrade_applied;
CREATE TRIGGER adjustment_guard BEFORE INSERT ON order_adjustments BEGIN
 SELECT RAISE(ABORT,'UPGRADE_NOT_ALLOWED') WHERE NEW.kind='UPGRADE' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.delivery_mode='DOWNSTAIRS' AND o.delivery_upgrade_fen=0 AND o.student_deleted=0
 AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY') AND ((o.package_size='LARGE' AND NEW.amount_fen=200) OR (o.package_size='SMALL' AND NEW.amount_fen=100)) AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY'));
 SELECT RAISE(ABORT,'REFUND_NOT_ALLOWED') WHERE NEW.kind='REFUND' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND (o.student_deleted=1 OR o.student_cancelled=1) AND o.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')
 AND NEW.amount_fen=(SELECT amount_fen FROM payments WHERE order_id=o.id AND type='DELIVERY')+o.delivery_upgrade_fen+o.upgrade_surcharge_fen);
END;
CREATE TRIGGER upgrade_applied AFTER INSERT ON order_adjustments WHEN NEW.kind='UPGRADE' BEGIN
 UPDATE delivery_orders SET delivery_upgrade_fen=100,upgrade_surcharge_fen=NEW.amount_fen-100,version=version+1,updated_at=unixepoch(),last_actor_type='STUDENT',last_actor_id=user_id WHERE id=NEW.order_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT lower(hex(randomblob(16))),'STUDENT',user_id,'MOCK_DELIVERY_UPGRADE',id FROM delivery_orders WHERE id=NEW.order_id;
END;

DROP TRIGGER order_transition_guard;
CREATE TRIGGER order_transition_guard BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'INVALID_TRANSITION') WHERE NOT (
 (NEW.status='WAITING_PICKUP' AND NEW.student_deleted=0 AND NEW.last_actor_type='ADMIN'
 AND EXISTS(SELECT 1 FROM order_releases r WHERE r.order_id=OLD.id AND r.order_version=OLD.version)
 AND OLD.status IN ('WAITING_PICKUP','FAILED_PICKUP','DELIVERY_EXCEPTION','CANCELLED')) OR
 (OLD.status='WAITING_PAYMENT' AND NEW.status='WAITING_PICKUP' AND EXISTS(SELECT 1 FROM payments WHERE order_id=OLD.id AND type='DELIVERY')) OR
 (OLD.status='WAITING_PAYMENT' AND NEW.status='CANCELLED') OR
 (OLD.status='WAITING_PICKUP' AND NEW.status IN ('PICKED_UP','FAILED_PICKUP','CANCELLED')) OR
 (OLD.status='PICKED_UP' AND NEW.status IN ('OUT_FOR_DELIVERY','DELIVERY_EXCEPTION')) OR
 (OLD.status='OUT_FOR_DELIVERY' AND (NEW.status='DELIVERY_EXCEPTION' OR (NEW.status='DELIVERED_DOWNSTAIRS' AND OLD.delivery_mode='DOWNSTAIRS' AND OLD.delivery_upgrade_fen=0) OR (NEW.status='DELIVERED_TO_ROOM' AND (OLD.delivery_mode='ROOM' OR OLD.delivery_upgrade_fen=100)))) OR
 (OLD.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM') AND NEW.status='COMPLETED') OR
 (OLD.status='FAILED_PICKUP' AND NEW.status IN ('WAITING_PICKUP','CANCELLED')) OR
 (OLD.status='DELIVERY_EXCEPTION' AND NEW.status IN ('OUT_FOR_DELIVERY','CANCELLED')) OR
 (NEW.status='CANCELLED' AND (NEW.student_deleted=1 OR NEW.student_cancelled=1) AND NEW.last_actor_type='STUDENT' AND OLD.status IN ('PICKED_UP','OUT_FOR_DELIVERY'))
 );
END;


DROP TRIGGER release_guard;
CREATE TRIGGER release_guard BEFORE INSERT ON order_releases BEGIN
 SELECT RAISE(ABORT,'RELEASE_NOT_ALLOWED') WHERE NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.version=NEW.order_version AND o.student_deleted=0 AND o.student_cancelled=0 AND o.custody_state<>'STAFF'
 AND o.status IN ('WAITING_PICKUP','FAILED_PICKUP','DELIVERY_EXCEPTION','CANCELLED')
 AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY')
 AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=o.id AND kind='REFUND')
 AND EXISTS(SELECT 1 FROM parcels WHERE id=o.parcel_id AND status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM delivery_orders other WHERE other.parcel_id=o.parcel_id AND other.id<>o.id AND other.status<>'CANCELLED'));
END;

DROP TRIGGER student_order_removed;
CREATE TRIGGER student_order_removed AFTER UPDATE OF student_deleted ON delivery_orders WHEN OLD.student_deleted=0 AND NEW.student_deleted=1 BEGIN
 INSERT INTO order_adjustments(id,order_id,kind,amount_fen)
 SELECT lower(hex(randomblob(16))),NEW.id,'REFUND',p.amount_fen+NEW.delivery_upgrade_fen+NEW.upgrade_surcharge_fen FROM payments p WHERE p.order_id=NEW.id AND p.type='DELIVERY'
 AND NEW.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=NEW.id AND kind='REFUND');
 UPDATE delivery_orders SET status='CANCELLED' WHERE id=NEW.id AND status NOT IN ('CANCELLED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
 UPDATE parcels SET status='CANCELLED' WHERE id=NEW.parcel_id AND NEW.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'STUDENT',NEW.user_id,'STUDENT_ORDER_REMOVED',NEW.id);
END;

CREATE TRIGGER student_order_cancelled AFTER UPDATE OF student_cancelled ON delivery_orders WHEN OLD.student_cancelled=0 AND NEW.student_cancelled=1 BEGIN
 INSERT INTO order_adjustments(id,order_id,kind,amount_fen)
 SELECT lower(hex(randomblob(16))),NEW.id,'REFUND',p.amount_fen+NEW.delivery_upgrade_fen+NEW.upgrade_surcharge_fen FROM payments p WHERE p.order_id=NEW.id AND p.type='DELIVERY'
 AND NEW.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=NEW.id AND kind='REFUND');
 UPDATE delivery_orders SET status='CANCELLED',service_notice='学生已取消配送，模拟退款结果可在订单详情查看。' WHERE id=NEW.id AND status<>'CANCELLED';
 UPDATE parcels SET status='CANCELLED' WHERE id=NEW.parcel_id;
 DELETE FROM batch_items WHERE order_id=NEW.id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'STUDENT',NEW.user_id,'STUDENT_ORDER_CANCELLED',NEW.id);
END;
