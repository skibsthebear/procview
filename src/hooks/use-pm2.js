'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

const ACTION_TIMEOUT = 10000;
const RECONNECT_BASE = 1000;
const RECONNECT_CAP = 30000;

export function usePM2() {
  const [processes, setProcesses] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pendingActions = useRef(new Map());
  const reconnectDelay = useRef(RECONNECT_BASE);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE;
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case MessageType.PROCESS_LIST:
          setProcesses(msg.data);
          break;
        case MessageType.ACTION_RESULT: {
          const pending = pendingActions.current.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            if (msg.success) pending.resolve();
            else pending.reject(new Error(msg.error || 'Action failed'));
            pendingActions.current.delete(msg.id);
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reject all pending actions
      for (const [id, pending] of pendingActions.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket disconnected'));
      }
      pendingActions.current.clear();

      // Reconnect with exponential backoff
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_CAP);
          connectWs();
        }, reconnectDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  const executeAction = useCallback((appName, action) => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'));
      }

      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingActions.current.delete(id);
        reject(new Error('Action timed out'));
      }, ACTION_TIMEOUT);

      pendingActions.current.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: MessageType.ACTION, id, appName, action }));
    });
  }, []);

  return { processes, connected, executeAction };
}
