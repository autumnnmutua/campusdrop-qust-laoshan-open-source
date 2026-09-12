CREATE TABLE campuses (
  id TEXT PRIMARY KEY CHECK (id = 'QUST_LAOSHAN'),
  name TEXT NOT NULL, address TEXT NOT NULL
);
CREATE TABLE dorm_buildings (
  code TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  zone TEXT NOT NULL CHECK (zone IN ('SOUTH', 'NORTH')),
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL,
  UNIQUE(code, campus_id, zone)
);
CREATE INDEX dorm_zone_sort ON dorm_buildings(campus_id, zone, active, sort_order);
CREATE TABLE stations (
  code TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json)),
  relative_location TEXT NOT NULL,
  lat REAL CHECK (lat BETWEEN -90 AND 90),
  lng REAL CHECK (lng BETWEEN -180 AND 180),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE user_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  zone TEXT NOT NULL CHECK (zone IN ('SOUTH','NORTH')),
  dorm_building_code TEXT NOT NULL,
  room_no TEXT NOT NULL CHECK (length(room_no) BETWEEN 1 AND 32),
  valid_from INTEGER NOT NULL DEFAULT (unixepoch()),
  valid_to INTEGER,
  FOREIGN KEY (dorm_building_code, campus_id, zone) REFERENCES dorm_buildings(code, campus_id, zone),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX one_current_address ON user_addresses(user_id) WHERE valid_to IS NULL;
CREATE INDEX address_history ON user_addresses(user_id, valid_from);
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','ZONE_ADMIN','BUILDING_ADMIN','DELIVERY_STAFF')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE admin_scopes (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  zone TEXT CHECK (zone IN ('SOUTH','NORTH')),
  building_code TEXT REFERENCES dorm_buildings(code),
  CHECK (zone IS NOT NULL OR building_code IS NOT NULL),
  FOREIGN KEY (building_code, campus_id, zone) REFERENCES dorm_buildings(code, campus_id, zone)
);
CREATE UNIQUE INDEX unique_admin_scope ON admin_scopes(admin_id, campus_id, ifnull(zone,''), ifnull(building_code,''));
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  admin_id TEXT REFERENCES admin_users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) != (admin_id IS NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX session_user ON sessions(user_id);
CREATE INDEX session_admin ON sessions(admin_id);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE rate_limits (
  key_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limit_expiry ON rate_limits(expires_at);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('STUDENT','ADMIN','SYSTEM')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_redacted TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_redacted)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX audit_actor ON audit_logs(actor_id, created_at);
CREATE INDEX audit_resource ON audit_logs(resource_id, created_at);
