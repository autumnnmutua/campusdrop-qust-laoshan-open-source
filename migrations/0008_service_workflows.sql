CREATE TABLE inbox_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),order_id TEXT REFERENCES delivery_orders(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,title TEXT NOT NULL,read_at INTEGER,created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX inbox_owner ON inbox_messages(user_id,id DESC);
CREATE TRIGGER notify_order_status AFTER UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) VALUES(NEW.user_id,NEW.id,NEW.status,'订单进度已更新，请查看详情');
END;
CREATE TRIGGER notify_claim AFTER INSERT ON batch_items BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'CLAIMED','配送员已接单，可查看联系电话' FROM delivery_orders WHERE id=NEW.order_id;
END;
CREATE TRIGGER notify_release AFTER INSERT ON order_releases BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'RELEASED','订单已退回接单市场，请查看退回理由' FROM delivery_orders WHERE id=NEW.order_id;
END;
CREATE TRIGGER notify_refund AFTER INSERT ON order_adjustments WHEN NEW.kind='REFUND' BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'REFUND','退款记录已更新，未发生真实资金流转' FROM delivery_orders WHERE id=NEW.order_id;
END;
ALTER TABLE delivery_orders ADD COLUMN received_at INTEGER;
CREATE TRIGGER student_receipt_guard BEFORE UPDATE OF status ON delivery_orders WHEN OLD.status<>NEW.status AND NEW.status='COMPLETED' BEGIN
 SELECT RAISE(ABORT,'STUDENT_RECEIPT_REQUIRED') WHERE NEW.last_actor_type<>'STUDENT' OR NEW.last_actor_id<>NEW.user_id OR NEW.received_at IS NULL;
END;
CREATE TABLE support_tickets (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES delivery_orders(id),user_id TEXT NOT NULL REFERENCES users(id),
 category TEXT NOT NULL CHECK(category IN ('NOT_RECEIVED','DAMAGED','WRONG_DELIVERY','REFUND','OTHER')),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 80),status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
 version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL DEFAULT(unixepoch()),updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE UNIQUE INDEX support_active_order ON support_tickets(order_id) WHERE status<>'CLOSED';
CREATE INDEX support_user ON support_tickets(user_id,created_at DESC,id DESC);
CREATE TABLE ticket_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
 actor_kind TEXT NOT NULL CHECK(actor_kind IN ('STUDENT','ADMIN')),actor_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX ticket_message_order ON ticket_messages(ticket_id,id);
CREATE TRIGGER ticket_message_event AFTER INSERT ON ticket_messages BEGIN
 UPDATE support_tickets SET updated_at=unixepoch(),version=version+1 WHERE id=NEW.ticket_id;
 INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(lower(hex(randomblob(16))),NEW.actor_kind,NEW.actor_id,'TICKET_MESSAGE_ADDED',NEW.ticket_id);
 INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,order_id,'TICKET_REPLY','售后工单收到新回复' FROM support_tickets WHERE id=NEW.ticket_id AND NEW.actor_kind='ADMIN';
END;
CREATE TRIGGER ticket_status_event AFTER UPDATE OF status ON support_tickets WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO inbox_messages(user_id,order_id,kind,title) VALUES(NEW.user_id,NEW.order_id,'TICKET_STATUS','售后处理进度已更新');
END;
CREATE INDEX releases_order_history ON order_releases(order_id,created_at,id);
