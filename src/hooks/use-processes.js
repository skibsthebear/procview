'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

const ACTION_TIMEOUT = 10000;
const RECONNECT_BASE = 1000;
const RECONNECT_CAP = 30000;

export function useProcesses() {
  const [processes, setProcesses] = useState([]);
  const [collectorStatus, setCollectorStatus] = useState({});
  const [connectionState, setConnectionState] = useState('connecting');
  const wsRef = useRef(null);
  const pendingActions = useRef(new Map());
  const reconnectDelay = useRef(RECONNECT_BASE);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);
  const hasConnectedRef = useRef(false);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      hasConnectedRef.current = true;
      setConnectionState('connected');
      reconnectDelay.current = RECONNECT_BASE;
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case MessageType.PROCESS_LIST:
          setProcesses(msg.data);
          break;
        case MessageType.COLLECTOR_STATUS:
          setCollectorStatus(msg.collectors);
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
        default:
          // Dispatch to registered external handlers (e.g., SETTINGS_RESULT)
          for (const handler of externalHandlers.current) {
            if (handler(msg)) break;
          }
          break;
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;

      for (const [, pending] of pendingActions.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket disconnected'));
      }
      pendingActions.current.clear();

      if (mountedRef.current) {
        const nextDelay = Math.min(reconnectDelay.current * 2, RECONNECT_CAP);
        reconnectDelay.current = nextDelay;
        setConnectionState(
          nextDelay >= RECONNECT_CAP
            ? 'failed'
            : hasConnectedRef.current ? 'reconnecting' : 'connecting'
        );
        reconnectTimer.current = setTimeout(connectWs, reconnectDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, []);

  const retryNow = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectDelay.current = RECONNECT_BASE;
    setConnectionState(
      hasConnectedRef.current ? 'reconnecting' : 'connecting'
    );
    connectWs();
  }, [connectWs]);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connectWs]);

  const executeAction = useCallback((source, processId, action) => {
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
      ws.send(JSON.stringify({
        type: MessageType.ACTION,
        id,
        source,
        processId,
        action,
      }));
    });
  }, []);

  // Expose sendMessage for other hooks (e.g., useSettings) to send WS messages
  const sendMessage = useCallback((msgObject) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    ws.send(JSON.stringify(msgObject));
  }, []);

  // Allow registering external message handlers (e.g., for SETTINGS_RESULT)
  const externalHandlers = useRef([]);
  const registerMessageHandler = useCallback((handler) => {
    externalHandlers.current.push(handler);
    return () => {
      externalHandlers.current = externalHandlers.current.filter((h) => h !== handler);
    };
  }, []);

  const connected = connectionState === 'connected';
  return { processes, collectorStatus, connected, connectionState, retryNow, executeAction, sendMessage, registerMessageHandler };
}
