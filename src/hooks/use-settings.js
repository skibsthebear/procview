'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

export function useSettings(sendMessage, registerMessageHandler) {
  const [settings, setSettings] = useState({
    allowlist: [],
    hidden: [],
    customNames: {},
    notes: {},
  });
  const [loaded, setLoaded] = useState(false);
  const pendingSettings = useRef(new Map());

  // Fetch initial settings via REST
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setLoaded(true);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err.message);
        setLoaded(true); // proceed with defaults
      });
  }, []);

  // Register handler for SETTINGS_RESULT messages via useProcesses
  useEffect(() => {
    if (!registerMessageHandler) return;
    const unregister = registerMessageHandler((msg) => {
      if (msg.type !== MessageType.SETTINGS_RESULT) return false;
      const pending = pendingSettings.current.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        if (msg.success) pending.resolve();
        else pending.reject(new Error(msg.error || 'Settings update failed'));
        pendingSettings.current.delete(msg.id);
      }
      return true;
    });
    return unregister;
  }, [registerMessageHandler]);

  const sendSettingsUpdate = useCallback((mutation) => {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSettings.current.delete(id);
        reject(new Error('Settings update timed out'));
      }, 10000);

      pendingSettings.current.set(id, { resolve, reject, timer });
      try {
        sendMessage({ type: MessageType.UPDATE_SETTINGS, id, ...mutation });
      } catch (err) {
        clearTimeout(timer);
        pendingSettings.current.delete(id);
        reject(err);
      }
    });
  }, [sendMessage]);

  // Convenience mutators (optimistic UI updates)
  const hideProcess = useCallback(async (processId) => {
    setSettings((prev) => ({
      ...prev,
      hidden: [...prev.hidden, processId],
    }));
    try {
      await sendSettingsUpdate({ hide: processId });
    } catch {
      // Revert on failure
      setSettings((prev) => ({
        ...prev,
        hidden: prev.hidden.filter((id) => id !== processId),
      }));
    }
  }, [sendSettingsUpdate]);

  const unhideProcess = useCallback(async (processId) => {
    setSettings((prev) => ({
      ...prev,
      hidden: prev.hidden.filter((id) => id !== processId),
    }));
    try {
      await sendSettingsUpdate({ unhide: processId });
    } catch {
      setSettings((prev) => ({
        ...prev,
        hidden: [...prev.hidden, processId],
      }));
    }
  }, [sendSettingsUpdate]);

  const setCustomName = useCallback(async (processId, name) => {
    setSettings((prev) => ({
      ...prev,
      customNames: { ...prev.customNames, [processId]: name },
    }));
    try {
      await sendSettingsUpdate({ setCustomName: { processId, name } });
    } catch {
      setSettings((prev) => {
        const updated = { ...prev.customNames };
        delete updated[processId];
        return { ...prev, customNames: updated };
      });
    }
  }, [sendSettingsUpdate]);

  const removeCustomName = useCallback(async (processId) => {
    const prev = settings.customNames[processId];
    setSettings((s) => {
      const updated = { ...s.customNames };
      delete updated[processId];
      return { ...s, customNames: updated };
    });
    try {
      await sendSettingsUpdate({ removeCustomName: processId });
    } catch {
      if (prev) setSettings((s) => ({ ...s, customNames: { ...s.customNames, [processId]: prev } }));
    }
  }, [sendSettingsUpdate, settings.customNames]);

  const setNote = useCallback(async (processId, note) => {
    setSettings((prev) => ({
      ...prev,
      notes: { ...prev.notes, [processId]: note },
    }));
    try {
      await sendSettingsUpdate({ setNote: { processId, note } });
    } catch {
      setSettings((prev) => {
        const updated = { ...prev.notes };
        delete updated[processId];
        return { ...prev, notes: updated };
      });
    }
  }, [sendSettingsUpdate]);

  const updateAllowlist = useCallback(async (newAllowlist) => {
    const prevAllowlist = settings.allowlist;
    setSettings((prev) => ({ ...prev, allowlist: newAllowlist }));
    try {
      await sendSettingsUpdate({
        allowlist: {
          processNames: newAllowlist.filter(e => e.type === 'process_name').map(e => e.value),
          portRanges: newAllowlist.filter(e => e.type === 'port_range').map(e => e.value),
        },
      });
    } catch {
      setSettings((prev) => ({ ...prev, allowlist: prevAllowlist }));
    }
  }, [sendSettingsUpdate, settings.allowlist]);

  const isHidden = useCallback((processId) => {
    return settings.hidden.includes(processId);
  }, [settings.hidden]);

  const getDisplayName = useCallback((process) => {
    return settings.customNames[process.id] || process.name;
  }, [settings.customNames]);

  return {
    settings,
    loaded,
    hideProcess,
    unhideProcess,
    setCustomName,
    removeCustomName,
    setNote,
    updateAllowlist,
    isHidden,
    getDisplayName,
  };
}
