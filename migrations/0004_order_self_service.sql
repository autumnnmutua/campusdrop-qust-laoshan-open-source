ALTER TABLE delivery_orders ADD COLUMN order_note TEXT NOT NULL DEFAULT '' CHECK(length(order_note)<=120);
ALTER TABLE delivery_orders ADD COLUMN student_deleted INTEGER NOT NULL DEFAULT 0 CHECK(student_deleted IN (0,1));
ALTER TABLE delivery_orders ADD COLUMN delivery_upgrade_fen INTEGER NOT NULL DEFAULT 0 CHECK(delivery_upgrade_fen IN (0,100));
UPDATE delivery_orders SET order_note=COALESCE((SELECT note FROM parcels WHERE id=parcel_id),'');
CREATE TABLE order_adjustments (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('UPGRADE','REFUND')),
 amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
 provider TEXT NOT NULL DEFAULT 'MOCK' CHECK(provider='MOCK'),
 status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK(status='SUCCEEDED'),
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 UNIQUE(order_id,kind)
);
CREATE TRIGGER adjustment_guard BEFORE INSERT ON order_adjustments BEGIN
 SELECT RAISE(ABORT,'UPGRADE_NOT_ALLOWED') WHERE NEW.kind='UPGRADE' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.delivery_mode='DOWNSTAIRS' AND o.delivery_upgrade_fen=0 AND o.student_deleted=0
 AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY') AND NEW.amount_fen=100 AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY'));
 SELECT RAISE(ABORT,'REFUND_NOT_ALLOWED') WHERE NEW.kind='REFUND' AND NOT EXISTS(
 SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.student_deleted=1 AND o.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')
 AND NEW.amount_fen=(SELECT amount_fen FROM payments WHERE order_id=o.id AND type='DELIVERY')+o.delivery_upgrade_fen);
END;
CREATE TRIGGER upgrade_applied AFTER INSERT ON order_adjustments WHEN NEW.kind='UPGRADE' BEGIN
 UPDATE delivery_orders SET delivery_upgrade_fen=100,version=version+1,updated_at=unixepoch(),last_actor_type='STUDENT',last_actor_id=user_id WHERE id=NEW.order_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT lower(hex(randomblob(16))),'STUDENT',user_id,'MOCK_DELIVERY_UPGRADE',id FROM delivery_orders WHERE id=NEW.order_id;
END;
DROP TRIGGER order_transition_guard;
CREATE TRIGGER order_transition_guard BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'INVALID_TRANSITION') WHERE NOT (
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
CREATE TRIGGER student_order_removed AFTER UPDATE OF student_deleted ON delivery_orders WHEN OLD.student_deleted=0 AND NEW.student_deleted=1 BEGIN
 INSERT INTO order_adjustments(id,order_id,kind,amount_fen)
 SELECT lower(hex(randomblob(16))),NEW.id,'REFUND',p.amount_fen+NEW.delivery_upgrade_fen FROM payments p WHERE p.order_id=NEW.id AND p.type='DELIVERY'
 AND NEW.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=NEW.id AND kind='REFUND');
 UPDATE delivery_orders SET status='CANCELLED' WHERE id=NEW.id AND status NOT IN ('CANCELLED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
 UPDATE parcels SET status='CANCELLED' WHERE id=NEW.parcel_id AND NEW.status NOT IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED');
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'STUDENT',NEW.user_id,'STUDENT_ORDER_REMOVED',NEW.id);
END;
CREATE TRIGGER order_note_audit AFTER UPDATE OF order_note ON delivery_orders BEGIN
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),'STUDENT',NEW.user_id,'ORDER_NOTE_UPDATED',NEW.id);
END;
