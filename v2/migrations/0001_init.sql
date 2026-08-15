CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  signing_public TEXT NOT NULL,
  receiving_public TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  recipient_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  sender_device_id TEXT NOT NULL,
  envelope TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_created ON messages(recipient_device_id,created_at);

-- attachment_owners: bind an attachmentId to the device that first uploaded it.
-- Populated on the first PUT chunk; checked on every subsequent PUT and GET.
-- This prevents any authenticated device from overwriting or reading attachments
-- it didn't upload and wasn't sent as a recipient.
CREATE TABLE IF NOT EXISTS attachment_owners (
  attachment_id TEXT PRIMARY KEY,
  owner_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
