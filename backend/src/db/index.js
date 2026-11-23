import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import path from 'path'
import { config } from '../config.js'
import { runMigrations } from './migrations.js'

let db

export function initDb(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, { dbPath })
  return db
}

export function closeDb() {
  if (db) db.close()
  db = undefined
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call initDb() first')
  return db
}
