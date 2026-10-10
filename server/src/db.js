import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const filename = process.env.DATABASE_PATH || './server/data/alsaha.sqlite';
fs.mkdirSync(path.dirname(path.resolve(filename)), {recursive:true});
export const db = new Database(filename);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, game_id TEXT NOT NULL, host_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'lobby', settings TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, room_code TEXT NOT NULL, name TEXT NOT NULL, image TEXT, is_host INTEGER NOT NULL DEFAULT 0, connected INTEGER NOT NULL DEFAULT 1, team TEXT, score INTEGER NOT NULL DEFAULT 0, session_hash TEXT NOT NULL, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, FOREIGN KEY(room_code) REFERENCES rooms(code));
CREATE INDEX IF NOT EXISTS players_room_idx ON players(room_code);
CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, round_no INTEGER NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS score_events(id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, player_id TEXT NOT NULL, points INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
`);
