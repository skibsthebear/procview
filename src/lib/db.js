'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.resolve(
  process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'procview.db')
);

const DEFAULT_SEEDS = [
  { type: 'process_name', value: 'node' },
  { type: 'process_name', value: 'python' },
  { type: 'process_name', value: 'python3' },
  { type: 'process_name', value: 'uvicorn' },
  { type: 'process_name', value: 'gunicorn' },
  { type: 'process_name', value: 'flask' },
  { type: 'process_name', value: 'vite' },
  { type: 'port_range', value: '3000-9999' },
];

let db = null;
let stmts = null;

function _init(dbPath = DEFAULT_DB_PATH) {
  _close();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  _createTables();
  _prepareStatements();
}

function _close() {
  if (db) {
    db.close();
    db = null;
    stmts = null;
  }
}

function _createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS allowlist (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      value       TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id  TEXT NOT NULL UNIQUE,
      note        TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_names (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id  TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hidden (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id  TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL
    );
  `);

  // Seed allowlist if empty
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM allowlist').get();
  if (count.cnt === 0) {
    const insert = db.prepare('INSERT INTO allowlist (type, value) VALUES (@type, @value)');
    const seedAll = db.transaction((seeds) => {
      for (const seed of seeds) insert.run(seed);
    });
    seedAll(DEFAULT_SEEDS);
  }
}

function _prepareStatements() {
  stmts = {
    // Allowlist
    getAllowlist: db.prepare('SELECT id, type, value, enabled FROM allowlist ORDER BY id'),
    addAllowlistEntry: db.prepare('INSERT INTO allowlist (type, value) VALUES (@type, @value)'),
    removeAllowlistEntry: db.prepare('DELETE FROM allowlist WHERE id = @id'),
    toggleAllowlistEntry: db.prepare('UPDATE allowlist SET enabled = @enabled WHERE id = @id'),
    clearAllowlist: db.prepare('DELETE FROM allowlist'),

    // Notes
    getNote: db.prepare('SELECT note FROM notes WHERE process_id = @processId'),
    setNote: db.prepare(
      `INSERT INTO notes (process_id, note, updated_at)
       VALUES (@processId, @note, datetime('now'))
       ON CONFLICT(process_id) DO UPDATE SET note = @note, updated_at = datetime('now')`
    ),
    removeNote: db.prepare('DELETE FROM notes WHERE process_id = @processId'),
    getAllNotes: db.prepare('SELECT process_id, note FROM notes'),

    // Custom names
    getCustomName: db.prepare('SELECT name FROM custom_names WHERE process_id = @processId'),
    setCustomName: db.prepare(
      `INSERT INTO custom_names (process_id, name, updated_at)
       VALUES (@processId, @name, datetime('now'))
       ON CONFLICT(process_id) DO UPDATE SET name = @name, updated_at = datetime('now')`
    ),
    removeCustomName: db.prepare('DELETE FROM custom_names WHERE process_id = @processId'),
    getAllCustomNames: db.prepare('SELECT process_id, name FROM custom_names'),

    // Hidden
    hideProcess: db.prepare(
      'INSERT OR IGNORE INTO hidden (process_id) VALUES (@processId)'
    ),
    unhideProcess: db.prepare('DELETE FROM hidden WHERE process_id = @processId'),
    getHidden: db.prepare('SELECT process_id FROM hidden'),

    // Settings
    getSetting: db.prepare('SELECT value FROM settings WHERE key = @key'),
    setSetting: db.prepare(
      `INSERT INTO settings (key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = @value`
    ),
  };
}

// --- Public API ---

function getAllowlist() {
  return stmts.getAllowlist.all();
}

function addAllowlistEntry(type, value) {
  const info = stmts.addAllowlistEntry.run({ type, value });
  return Number(info.lastInsertRowid);
}

function removeAllowlistEntry(id) {
  stmts.removeAllowlistEntry.run({ id });
}

function toggleAllowlistEntry(id, enabled) {
  stmts.toggleAllowlistEntry.run({ id, enabled });
}

function replaceAllowlist(entries) {
  const tx = db.transaction((items) => {
    stmts.clearAllowlist.run();
    for (const item of items) {
      stmts.addAllowlistEntry.run({ type: item.type, value: item.value });
    }
  });
  tx(entries);
}

function getNote(processId) {
  const row = stmts.getNote.get({ processId });
  return row ? row.note : null;
}

function setNote(processId, note) {
  stmts.setNote.run({ processId, note });
}

function removeNote(processId) {
  stmts.removeNote.run({ processId });
}

function getAllNotes() {
  const rows = stmts.getAllNotes.all();
  const result = {};
  for (const row of rows) result[row.process_id] = row.note;
  return result;
}

function getCustomName(processId) {
  const row = stmts.getCustomName.get({ processId });
  return row ? row.name : null;
}

function setCustomName(processId, name) {
  stmts.setCustomName.run({ processId, name });
}

function removeCustomName(processId) {
  stmts.removeCustomName.run({ processId });
}

function getAllCustomNames() {
  const rows = stmts.getAllCustomNames.all();
  const result = {};
  for (const row of rows) result[row.process_id] = row.name;
  return result;
}

function hideProcess(processId) {
  stmts.hideProcess.run({ processId });
}

function unhideProcess(processId) {
  stmts.unhideProcess.run({ processId });
}

function getHidden() {
  return stmts.getHidden.all().map((row) => row.process_id);
}

function getSetting(key) {
  const row = stmts.getSetting.get({ key });
  return row ? row.value : null;
}

function setSetting(key, value) {
  stmts.setSetting.run({ key, value });
}

function getSettingsSnapshot() {
  return {
    allowlist: getAllowlist(),
    hidden: getHidden(),
    customNames: getAllCustomNames(),
    notes: getAllNotes(),
  };
}

module.exports = {
  _init,
  _close,
  getAllowlist,
  addAllowlistEntry,
  removeAllowlistEntry,
  toggleAllowlistEntry,
  replaceAllowlist,
  getNote,
  setNote,
  removeNote,
  getAllNotes,
  getCustomName,
  setCustomName,
  removeCustomName,
  getAllCustomNames,
  hideProcess,
  unhideProcess,
  getHidden,
  getSetting,
  setSetting,
  getSettingsSnapshot,
};
