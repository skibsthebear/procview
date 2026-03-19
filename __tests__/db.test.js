import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// CJS interop — db.js exports via module.exports
import db from '../src/lib/db';

const TEST_DB_PATH = path.join(__dirname, '../data/test-procview.db');

describe('db', () => {
  beforeEach(() => {
    // Point db at test database
    db._init(TEST_DB_PATH);
  });

  afterEach(() => {
    db._close();
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '-wal'); } catch {}
    try { fs.unlinkSync(TEST_DB_PATH + '-shm'); } catch {}
  });

  describe('allowlist', () => {
    it('returns default seeds on first init', () => {
      const list = db.getAllowlist();
      expect(list.length).toBeGreaterThanOrEqual(7);
      expect(list.some(e => e.type === 'process_name' && e.value === 'node')).toBe(true);
      expect(list.some(e => e.type === 'port_range' && e.value === '3000-9999')).toBe(true);
    });

    it('adds a new entry', () => {
      const id = db.addAllowlistEntry('process_name', 'deno');
      expect(id).toBeGreaterThan(0);
      const list = db.getAllowlist();
      expect(list.some(e => e.value === 'deno')).toBe(true);
    });

    it('removes an entry', () => {
      const id = db.addAllowlistEntry('process_name', 'bun');
      db.removeAllowlistEntry(id);
      const list = db.getAllowlist();
      expect(list.some(e => e.value === 'bun')).toBe(false);
    });

    it('toggles an entry', () => {
      const list = db.getAllowlist();
      const entry = list[0];
      db.toggleAllowlistEntry(entry.id, 0);
      const updated = db.getAllowlist();
      expect(updated.find(e => e.id === entry.id).enabled).toBe(0);
    });

    it('replaces the full allowlist', () => {
      db.replaceAllowlist([
        { type: 'process_name', value: 'deno' },
        { type: 'port_range', value: '8000-9000' },
      ]);
      const list = db.getAllowlist();
      expect(list).toHaveLength(2);
      expect(list[0].value).toBe('deno');
      expect(list[1].value).toBe('8000-9000');
    });
  });

  describe('notes', () => {
    it('sets and gets a note', () => {
      db.setNote('pm2:myapp', 'Production API server');
      expect(db.getNote('pm2:myapp')).toBe('Production API server');
    });

    it('returns null for missing note', () => {
      expect(db.getNote('pm2:nonexistent')).toBeNull();
    });

    it('updates an existing note', () => {
      db.setNote('pm2:myapp', 'v1');
      db.setNote('pm2:myapp', 'v2');
      expect(db.getNote('pm2:myapp')).toBe('v2');
    });

    it('removes a note', () => {
      db.setNote('pm2:myapp', 'test');
      db.removeNote('pm2:myapp');
      expect(db.getNote('pm2:myapp')).toBeNull();
    });

    it('getAllNotes returns all notes as object', () => {
      db.setNote('pm2:a', 'note a');
      db.setNote('docker:b', 'note b');
      const notes = db.getAllNotes();
      expect(notes).toEqual({ 'pm2:a': 'note a', 'docker:b': 'note b' });
    });
  });

  describe('custom names', () => {
    it('sets and gets a custom name', () => {
      db.setCustomName('docker:abc123', 'Redis Cache');
      expect(db.getCustomName('docker:abc123')).toBe('Redis Cache');
    });

    it('returns null for missing custom name', () => {
      expect(db.getCustomName('docker:nope')).toBeNull();
    });

    it('removes a custom name', () => {
      db.setCustomName('pm2:app', 'My App');
      db.removeCustomName('pm2:app');
      expect(db.getCustomName('pm2:app')).toBeNull();
    });

    it('getAllCustomNames returns all as object', () => {
      db.setCustomName('pm2:a', 'App A');
      db.setCustomName('docker:b', 'App B');
      const names = db.getAllCustomNames();
      expect(names).toEqual({ 'pm2:a': 'App A', 'docker:b': 'App B' });
    });
  });

  describe('hidden processes', () => {
    it('hides a process', () => {
      db.hideProcess('pm2:myapp');
      expect(db.getHidden()).toContain('pm2:myapp');
    });

    it('unhides a process', () => {
      db.hideProcess('pm2:myapp');
      db.unhideProcess('pm2:myapp');
      expect(db.getHidden()).not.toContain('pm2:myapp');
    });

    it('hiding is idempotent', () => {
      db.hideProcess('pm2:myapp');
      db.hideProcess('pm2:myapp');
      expect(db.getHidden().filter(id => id === 'pm2:myapp')).toHaveLength(1);
    });
  });

  describe('settings', () => {
    it('sets and gets a setting', () => {
      db.setSetting('theme', 'dark');
      expect(db.getSetting('theme')).toBe('dark');
    });

    it('returns null for missing setting', () => {
      expect(db.getSetting('nonexistent')).toBeNull();
    });

    it('updates an existing setting', () => {
      db.setSetting('theme', 'dark');
      db.setSetting('theme', 'light');
      expect(db.getSetting('theme')).toBe('light');
    });
  });

  describe('getSettingsSnapshot', () => {
    it('returns allowlist, hidden, customNames, and notes', () => {
      db.setNote('pm2:a', 'note');
      db.setCustomName('pm2:a', 'App A');
      db.hideProcess('pm2:b');
      const snap = db.getSettingsSnapshot();
      expect(snap.allowlist).toBeDefined();
      expect(snap.hidden).toContain('pm2:b');
      expect(snap.customNames['pm2:a']).toBe('App A');
      expect(snap.notes['pm2:a']).toBe('note');
    });
  });
});
