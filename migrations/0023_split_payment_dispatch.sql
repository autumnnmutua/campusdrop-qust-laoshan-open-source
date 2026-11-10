-- Only future payments are affected. Keep existing batches and their ownership untouched.
-- Each new small order must follow the current, reachable courier of its building.
-- Reuse an automatic group batch only while all its members are still waiting safely.
DROP TRIGGER small_order_dispatch;
CREATE TRIGGER small_order_dispatch AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'WAITING_PICKUP' AND OLD.status = 'WAITING_PAYMENT' AND NEW.package_size = 'SMALL' AND NEW.demo_history = 0
  AND (NEW.group_id IS NULL OR NOT EXISTS (SELECT 1 FROM delivery_orders g WHERE g.group_id = NEW.group_id AND g.package_size <> 'SMALL'))
  AND NOT EXISTS (SELECT 1 FROM batch_items WHERE order_id = NEW.id) BEGIN
  -- Give each newly needed batch an order-specific key. An old empty group batch is
  -- never rebound to a new assignee, because it may still carry historical work.
  INSERT INTO delivery_batches (id, station_code, assignee_admin_id, created_by, created_at)
  SELECT 'auto-p-' || NEW.id, NEW.station_code, bc.admin_id, bc.admin_id, unixepoch()
  FROM building_couriers bc JOIN admin_users a ON a.id = bc.admin_id AND a.status = 'ACTIVE'
    AND a.role IN ('DELIVERY_STAFF', 'SUPER_ADMIN')
    AND a.phone IS NOT NULL AND a.phone <> '' AND coalesce(a.demo_group, '') = bc.world
  WHERE bc.world = coalesce(NEW.demo_group, '') AND bc.building_code = NEW.dorm_building_code
    AND NOT EXISTS (
      SELECT 1 FROM delivery_batches b
      WHERE NEW.group_id IS NOT NULL AND b.id LIKE 'auto-%' AND b.station_code = NEW.station_code
        AND b.assignee_admin_id = bc.admin_id
        AND EXISTS (SELECT 1 FROM batch_items bi JOIN delivery_orders s ON s.id = bi.order_id
          WHERE bi.batch_id = b.id AND s.group_id = NEW.group_id)
        AND NOT EXISTS (SELECT 1 FROM batch_items bi JOIN delivery_orders s ON s.id = bi.order_id
          WHERE bi.batch_id = b.id AND (s.group_id IS NOT NEW.group_id OR s.station_code <> NEW.station_code
            OR s.dorm_building_code <> NEW.dorm_building_code OR coalesce(s.demo_group, '') <> coalesce(NEW.demo_group, '')
            OR s.status <> 'WAITING_PICKUP' OR s.custody_state = 'STAFF' OR s.student_deleted <> 0 OR s.student_cancelled <> 0
            OR EXISTS (SELECT 1 FROM parcel_handoffs h WHERE h.order_id = s.id AND h.status = 'PENDING')))
    );

  -- Resolve ownership and eligible group members inside the same payment transaction.
  -- This deliberately leaves the order in the market when the assignment is absent or invalid.
  INSERT INTO batch_items (batch_id, order_id, sort_order)
  SELECT b.id, NEW.id, coalesce((SELECT max(sort_order) + 1 FROM batch_items WHERE batch_id = b.id), 0)
  FROM building_couriers bc JOIN admin_users a ON a.id = bc.admin_id AND a.status = 'ACTIVE'
    AND a.role IN ('DELIVERY_STAFF', 'SUPER_ADMIN')
    AND a.phone IS NOT NULL AND a.phone <> '' AND coalesce(a.demo_group, '') = bc.world
  JOIN delivery_batches b ON b.assignee_admin_id = bc.admin_id AND b.station_code = NEW.station_code AND b.id LIKE 'auto-%'
  WHERE bc.world = coalesce(NEW.demo_group, '') AND bc.building_code = NEW.dorm_building_code
    AND (b.id = 'auto-p-' || NEW.id OR (NEW.group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM batch_items bi JOIN delivery_orders s ON s.id = bi.order_id
      WHERE bi.batch_id = b.id AND s.group_id = NEW.group_id)))
    AND NOT EXISTS (SELECT 1 FROM batch_items bi JOIN delivery_orders s ON s.id = bi.order_id
      WHERE bi.batch_id = b.id AND (s.group_id IS NOT NEW.group_id OR s.station_code <> NEW.station_code
        OR s.dorm_building_code <> NEW.dorm_building_code OR coalesce(s.demo_group, '') <> coalesce(NEW.demo_group, '')
        OR s.status <> 'WAITING_PICKUP' OR s.custody_state = 'STAFF' OR s.student_deleted <> 0 OR s.student_cancelled <> 0
        OR EXISTS (SELECT 1 FROM parcel_handoffs h WHERE h.order_id = s.id AND h.status = 'PENDING')))
    AND NOT EXISTS (SELECT 1 FROM batch_items WHERE order_id = NEW.id)
  ORDER BY CASE WHEN b.id = 'auto-p-' || NEW.id THEN 1 ELSE 0 END, b.created_at DESC, b.id
  LIMIT 1;
END;

-- A later payment changes the visible set of an in-progress merged delivery.
-- Invalidate versions previously read for waiting siblings, so a courier's
-- stale pickup request cannot silently advance an order added after that read.
-- The update is in the same D1 transaction as the new payment.
CREATE TRIGGER group_payment_invalidates_waiting_siblings AFTER UPDATE OF status ON delivery_orders
WHEN NEW.status = 'WAITING_PICKUP' AND OLD.status = 'WAITING_PAYMENT'
  AND NEW.group_id IS NOT NULL AND NEW.demo_history = 0 BEGIN
  UPDATE delivery_orders SET version = version + 1, updated_at = unixepoch()
  WHERE group_id = NEW.group_id AND id <> NEW.id AND status = 'WAITING_PICKUP'
    AND demo_history = 0 AND student_deleted = 0 AND student_cancelled = 0;
END;
