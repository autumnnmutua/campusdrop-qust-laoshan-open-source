-- v2.0 engagement: campus announcements and post-delivery ratings.
-- Additive only: two new tables and their indexes; no existing table, trigger or row is changed.

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK(level IN ('INFO','NOTICE','PAUSE')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 40),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 200),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  starts_at INTEGER NOT NULL DEFAULT(unixepoch()),
  ends_at INTEGER CHECK(ends_at IS NULL OR ends_at > starts_at),
  created_by TEXT NOT NULL REFERENCES admin_users(id),
  created_at INTEGER NOT NULL DEFAULT(unixepoch()),
  archived_at INTEGER
);
CREATE INDEX announcement_feed ON announcements(status, starts_at DESC);

-- One rating per completed order, written only by the order's student (enforced in the API and by the guard below).
CREATE TABLE order_ratings (
  order_id TEXT PRIMARY KEY REFERENCES delivery_orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
  comment TEXT NOT NULL DEFAULT '' CHECK(length(comment) <= 120),
  created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX rating_recent ON order_ratings(created_at DESC);
CREATE TRIGGER rating_guard BEFORE INSERT ON order_ratings BEGIN
  SELECT RAISE(ABORT,'RATING_NOT_ALLOWED') WHERE NOT EXISTS(
    SELECT 1 FROM delivery_orders o WHERE o.id=NEW.order_id AND o.user_id=NEW.user_id AND o.status='COMPLETED');
END;
