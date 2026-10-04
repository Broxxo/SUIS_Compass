import crypto from 'crypto';
import pool from '../config/database.js';

export type MailboxStatus = 'open' | 'done';

export type MailboxReply = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  own: boolean;
  fromAdmin: boolean;
};

export type MailboxMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole: string;
  status: MailboxStatus;
  own: boolean;
  replies: MailboxReply[];
};

const BODY_MAX = 2000;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function authorName(row: {
  name_zh: string | null;
  name_en: string | null;
  display_name: string | null;
  username: string;
}): string {
  const zh = (row.name_zh ?? '').trim();
  const en = (row.name_en ?? '').trim();
  if (zh && en) return `${zh} ${en}`;
  if (zh) return zh;
  if (en) return en;
  const display = (row.display_name ?? '').trim();
  if (display) return display;
  return row.username;
}

export async function ensureMailboxTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compass_mailbox_messages (
      id VARCHAR(50) PRIMARY KEY,
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS compass_mailbox_messages_created_at_idx
    ON compass_mailbox_messages (created_at DESC)
  `);
  await pool.query(`
    ALTER TABLE compass_mailbox_messages
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'compass_mailbox_messages_status_check'
      ) THEN
        ALTER TABLE compass_mailbox_messages
          ADD CONSTRAINT compass_mailbox_messages_status_check CHECK (status IN ('open', 'done'));
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compass_mailbox_replies (
      id VARCHAR(50) PRIMARY KEY,
      message_id VARCHAR(50) NOT NULL REFERENCES compass_mailbox_messages(id) ON DELETE CASCADE,
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS compass_mailbox_replies_message_idx
    ON compass_mailbox_replies (message_id, created_at)
  `);
}

async function viewerIsAdmin(userId: string): Promise<boolean> {
  const row = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0] as
    | { role: string }
    | undefined;
  return row?.role === 'admin' || row?.role === 'system-admin';
}

type NameRow = {
  name_zh: string | null;
  name_en: string | null;
  display_name: string | null;
  username: string;
};

type MessageRow = NameRow & {
  id: string;
  user_id: string;
  body: string;
  status: string;
  created_at: Date | string;
  role: string;
};

type ReplyRow = NameRow & {
  id: string;
  message_id: string;
  user_id: string;
  body: string;
  role: string;
  created_at: Date | string;
};

function asStatus(value: string): MailboxStatus {
  return value === 'done' ? 'done' : 'open';
}

function toReply(row: ReplyRow, viewerId: string): MailboxReply {
  return {
    id: row.id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    authorName: authorName(row),
    own: row.user_id === viewerId,
    fromAdmin: row.role === 'admin' || row.role === 'system-admin',
  };
}

function toMessage(row: MessageRow, viewerId: string, replies: MailboxReply[]): MailboxMessage {
  return {
    id: row.id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    authorName: authorName(row),
    authorRole: row.role,
    status: asStatus(row.status),
    own: row.user_id === viewerId,
    replies,
  };
}

export async function listMailboxMessages(userId: string): Promise<{ viewerIsAdmin: boolean; messages: MailboxMessage[] }> {
  await ensureMailboxTable();
  const isAdmin = await viewerIsAdmin(userId);
  const result = await pool.query(
    `SELECT m.id, m.user_id, m.body, m.status, m.created_at, u.name_zh, u.name_en, u.display_name, u.username, u.role
     FROM compass_mailbox_messages m
     JOIN users u ON u.id = m.user_id
     WHERE ($1::boolean OR m.user_id = $2)
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [isAdmin, userId],
  );
  const rows = result.rows as MessageRow[];
  const ids = rows.map((row) => row.id);
  const replyResult = ids.length
    ? await pool.query(
        `SELECT r.id, r.message_id, r.user_id, r.body, r.created_at, u.name_zh, u.name_en, u.display_name, u.username, u.role
         FROM compass_mailbox_replies r
         JOIN users u ON u.id = r.user_id
         WHERE r.message_id = ANY($1::varchar[])
         ORDER BY r.created_at ASC`,
        [ids],
      )
    : { rows: [] };
  const repliesByMessage = new Map<string, MailboxReply[]>();
  for (const row of replyResult.rows as ReplyRow[]) {
    const list = repliesByMessage.get(row.message_id) ?? [];
    list.push(toReply(row, userId));
    repliesByMessage.set(row.message_id, list);
  }
  return {
    viewerIsAdmin: isAdmin,
    messages: rows.map((row) => {
      const replies = repliesByMessage.get(row.id) ?? [];
      return toMessage(row, userId, isAdmin ? replies : replies.filter((item) => item.fromAdmin));
    }),
  };
}

export async function createMailboxMessage(
  userId: string,
  body: string,
): Promise<{ message: MailboxMessage } | { error: 'empty' | 'too_long' }> {
  const text = body.trim();
  if (!text) return { error: 'empty' };
  if (text.length > BODY_MAX) return { error: 'too_long' };
  await ensureMailboxTable();
  const id = newId('mail');
  await pool.query(`INSERT INTO compass_mailbox_messages (id, user_id, body) VALUES ($1, $2, $3)`, [id, userId, text]);
  const result = await pool.query(
    `SELECT m.id, m.user_id, m.body, m.status, m.created_at, u.name_zh, u.name_en, u.display_name, u.username, u.role
     FROM compass_mailbox_messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [id],
  );
  return { message: toMessage(result.rows[0] as MessageRow, userId, []) };
}

async function messageOwner(messageId: string): Promise<string | null> {
  const row = (await pool.query(`SELECT user_id FROM compass_mailbox_messages WHERE id = $1`, [messageId])).rows[0] as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

export async function replyToMailboxMessage(
  userId: string,
  messageId: string,
  body: string,
): Promise<{ reply: MailboxReply } | { error: 'empty' | 'too_long' | 'not_found' | 'forbidden' }> {
  const text = body.trim();
  if (!text) return { error: 'empty' };
  if (text.length > BODY_MAX) return { error: 'too_long' };
  await ensureMailboxTable();
  const ownerId = await messageOwner(messageId);
  if (!ownerId) return { error: 'not_found' };
  const isAdmin = await viewerIsAdmin(userId);
  if (!isAdmin) return { error: 'forbidden' };
  const id = newId('mailr');
  await pool.query(`INSERT INTO compass_mailbox_replies (id, message_id, user_id, body) VALUES ($1, $2, $3, $4)`, [
    id,
    messageId,
    userId,
    text,
  ]);
  const result = await pool.query(
    `SELECT r.id, r.message_id, r.user_id, r.body, r.created_at, u.name_zh, u.name_en, u.display_name, u.username, u.role
     FROM compass_mailbox_replies r
     JOIN users u ON u.id = r.user_id
     WHERE r.id = $1`,
    [id],
  );
  return { reply: toReply(result.rows[0] as ReplyRow, userId) };
}

export async function updateMailboxMessage(
  userId: string,
  messageId: string,
  body: string,
): Promise<{ id: string; body: string } | { error: 'empty' | 'too_long' | 'not_found' | 'forbidden' }> {
  const text = body.trim();
  if (!text) return { error: 'empty' };
  if (text.length > BODY_MAX) return { error: 'too_long' };
  await ensureMailboxTable();
  const ownerId = await messageOwner(messageId);
  if (!ownerId) return { error: 'not_found' };
  if (ownerId !== userId) return { error: 'forbidden' };
  await pool.query(`UPDATE compass_mailbox_messages SET body = $2 WHERE id = $1`, [messageId, text]);
  return { id: messageId, body: text };
}

export async function deleteMailboxMessage(
  userId: string,
  messageId: string,
): Promise<{ id: string } | { error: 'not_found' | 'forbidden' }> {
  await ensureMailboxTable();
  const ownerId = await messageOwner(messageId);
  if (!ownerId) return { error: 'not_found' };
  if (ownerId !== userId && !(await viewerIsAdmin(userId))) return { error: 'forbidden' };
  await pool.query(`DELETE FROM compass_mailbox_messages WHERE id = $1`, [messageId]);
  return { id: messageId };
}

export async function setMailboxStatus(
  userId: string,
  messageId: string,
  status: string,
): Promise<{ id: string; status: MailboxStatus } | { error: 'forbidden' | 'not_found' | 'bad_status' }> {
  if (status !== 'open' && status !== 'done') return { error: 'bad_status' };
  await ensureMailboxTable();
  if (!(await viewerIsAdmin(userId))) return { error: 'forbidden' };
  const result = await pool.query(`UPDATE compass_mailbox_messages SET status = $2 WHERE id = $1 RETURNING id`, [
    messageId,
    status,
  ]);
  if (!result.rows[0]) return { error: 'not_found' };
  return { id: messageId, status };
}
