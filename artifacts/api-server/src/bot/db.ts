import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "bot-data.db");
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    balance REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    account_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS submitted_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    file_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );
`);

// Migrate: add status column if missing (for existing DBs)
try {
  db.exec(`ALTER TABLE submitted_files ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`);
} catch { /* already exists */ }

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface User {
  telegram_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  balance: number;
  created_at: number;
}

export interface Withdrawal {
  id: number;
  user_id: number;
  amount: number;
  payment_method: string;
  account_number: string;
  status: string;
  created_at: number;
}

export interface SubmittedFile {
  id: number;
  user_id: number;
  file_id: string;
  file_name: string | null;
  file_type: string | null;
  status: string;
  submitted_at: number;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export function getOrCreateUser(
  telegramId: number,
  firstName: string,
  lastName?: string,
  username?: string,
): User {
  const existing = db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(telegramId) as User | undefined;

  if (!existing) {
    db.prepare(
      "INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)",
    ).run(telegramId, username ?? null, firstName, lastName ?? null);
  } else {
    db.prepare(
      "UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?",
    ).run(username ?? null, firstName, lastName ?? null, telegramId);
  }
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as User;
}

export function getUserBalance(telegramId: number): number {
  const row = db
    .prepare("SELECT balance FROM users WHERE telegram_id = ?")
    .get(telegramId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function addBalance(telegramId: number, amount: number): number {
  db.prepare("UPDATE users SET balance = balance + ? WHERE telegram_id = ?").run(amount, telegramId);
  return (
    db.prepare("SELECT balance FROM users WHERE telegram_id = ?").get(telegramId) as
      | { balance: number }
      | undefined
  )?.balance ?? 0;
}

export function getUserByTelegramId(telegramId: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as User | undefined;
}

// ─── Withdrawals ──────────────────────────────────────────────────────────────

export function createWithdrawal(
  userId: number,
  amount: number,
  paymentMethod: string,
  accountNumber: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO withdrawals (user_id, amount, payment_method, account_number) VALUES (?, ?, ?, ?)",
    )
    .run(userId, amount, paymentMethod, accountNumber);
  return result.lastInsertRowid as number;
}

export function getWithdrawal(id: number): Withdrawal | undefined {
  return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id) as Withdrawal | undefined;
}

export function updateWithdrawalStatus(id: number, status: "approved" | "rejected"): void {
  db.prepare("UPDATE withdrawals SET status = ? WHERE id = ?").run(status, id);
}

// ─── Submitted Files ──────────────────────────────────────────────────────────

export function saveSubmittedFile(
  userId: number,
  fileId: string,
  fileName?: string,
  fileType?: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO submitted_files (user_id, file_id, file_name, file_type) VALUES (?, ?, ?, ?)",
    )
    .run(userId, fileId, fileName ?? null, fileType ?? null);
  return result.lastInsertRowid as number;
}

export function getSubmittedFile(id: number): SubmittedFile | undefined {
  return db.prepare("SELECT * FROM submitted_files WHERE id = ?").get(id) as SubmittedFile | undefined;
}

export function updateFileStatus(id: number, status: "approved" | "rejected"): void {
  db.prepare("UPDATE submitted_files SET status = ? WHERE id = ?").run(status, id);
}

/** Format a numeric ID as SUB-000001 */
export function formatSubId(id: number): string {
  return `SUB-${String(id).padStart(6, "0")}`;
}
