-- Keep frequent-job lookups bounded as event and parcel history grows.
CREATE INDEX IF NOT EXISTS event_order_status_time
  ON order_events(order_id, to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS parcel_reminder_queue
  ON parcels(created_at, id)
  WHERE status = 'ACTIVE' AND reminded_at IS NULL;
