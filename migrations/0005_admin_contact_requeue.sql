ALTER TABLE admin_users ADD COLUMN phone TEXT CHECK(phone IS NULL OR (length(phone)=11 AND phone GLOB '1[3-9]*' AND phone NOT GLOB '*[^0-9]*'));
ALTER TABLE delivery_orders ADD COLUMN exception_note TEXT NOT NULL DEFAULT '' CHECK(length(exception_note)<=240);
ALTER TABLE delivery_orders ADD COLUMN service_notice TEXT NOT NULL DEFAULT '';
ALTER TABLE order_events ADD COLUMN detail TEXT NOT NULL DEFAULT '';
CREATE TABLE order_releases (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
 order_version INTEGER NOT NULL,
 admin_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(order_id,order_version)
);
CREATE TRIGGER release_guard BEFORE INSERT ON order_releases BEGIN
 SELECT RAISE(ABORT,'RELEASE_NOT_ALLOWED') WHERE NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.version=NEW.order_version AND o.student_deleted=0
 AND o.status IN ('WAITING_PICKUP','FAILED_PICKUP','DELIVERY_EXCEPTION','CANCELLED')
 AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY')
 AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=o.id AND kind='REFUND')
 AND EXISTS(SELECT 1 FROM parcels WHERE id=o.parcel_id AND status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM delivery_orders other WHERE other.parcel_id=o.parcel_id AND other.id<>o.id AND other.status<>'CANCELLED'));
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
 (NEW.status='CANCELLED' AND NEW.student_deleted=1 AND NEW.last_actor_type='STUDENT' AND OLD.status IN ('PICKED_UP','OUT_FOR_DELIVERY'))
 );
END;

CREATE TRIGGER release_applied AFTER INSERT ON order_releases BEGIN
 UPDATE delivery_orders SET status='WAITING_PICKUP',version=version+1,updated_at=unixepoch(),last_actor_type='ADMIN',last_actor_id=NEW.admin_id,
 exception_code=NULL,exception_note='',service_notice='配送员已退单，正在等待重新接单。原因：'||NEW.reason WHERE id=NEW.order_id;
 DELETE FROM batch_items WHERE order_id=NEW.order_id;
 INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,detail)
 VALUES(NEW.order_id,'WAITING_PICKUP','WAITING_PICKUP','ADMIN',NEW.admin_id,'配送员已退单，订单已返回接单市场。原因：'||NEW.reason);
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'ADMIN',NEW.admin_id,'ORDER_RELEASED',NEW.order_id);
END;
CREATE TRIGGER exception_detail AFTER UPDATE OF status ON delivery_orders WHEN NEW.status IN ('FAILED_PICKUP','DELIVERY_EXCEPTION') AND NEW.exception_note<>'' BEGIN
 INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,detail)
 VALUES(NEW.id,OLD.status,NEW.status,NEW.last_actor_type,NEW.last_actor_id,NEW.exception_note);
END;
CREATE TRIGGER claim_notice AFTER INSERT ON batch_items BEGIN
 UPDATE delivery_orders SET service_notice='已有配送员接单，可通过下方电话联系。' WHERE id=NEW.order_id;
END;
-- Repair only historical administrator cancellations that still have an active parcel and paid, unrefunded order.
-- Student cancellations/deletions and parcels with another active order are deliberately excluded.
INSERT INTO order_releases(id,order_id,order_version,admin_id,reason)
 SELECT lower(hex(randomblob(16))),o.id,o.version,o.last_actor_id,'原配送员取消接单，系统已恢复等待接单'
 FROM delivery_orders o WHERE o.status='CANCELLED' AND o.last_actor_type='ADMIN' AND o.student_deleted=0
 AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY')
 AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=o.id AND kind='REFUND')
 AND EXISTS(SELECT 1 FROM parcels WHERE id=o.parcel_id AND status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM delivery_orders other WHERE other.parcel_id=o.parcel_id AND other.id<>o.id AND other.status<>'CANCELLED');
