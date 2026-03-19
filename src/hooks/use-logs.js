'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageType } from '@/lib/ws-protocol';

const RECONNECT_BASE = 1000;
const RECONNECT_CAP = 30000;
const MAX_LINES = 2000;

export function useLogs(source, processId) {
  const [outLines, setOutLines] = useState([]);
  const [errLines, setErrLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectDelay = useRef(RECONNECT_BASE);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);

  const appendLines = useCallback((setter, newLines) => {
    setter((prev) => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_LINES
        ? combined.slice(combined.length - MAX_LINES)
        : combined;
    });
  }, []);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConnected(true);
      reconnectDelay.current = RECONNECT_BASE;
      ws.send(JSON.stringify({
        type: MessageType.SUBSCRIBE_LOGS,
        source,
        processId,
      }));
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === MessageType.LOG_LINES && msg.processId === processId) {
        if (msg.stream === 'out') appendLines(setOutLines, msg.lines);
        else if (msg.stream === 'err') appendLines(setErrLines, msg.lines);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_CAP);
          connectWs();
        }, reconnectDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, [source, processId, appendLines]);

  useEffect(() => {
    mountedRef.current = true;
    setOutLines([]);
    setErrLines([]);
    connectWs();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: MessageType.UNSUBSCRIBE_LOGS,
          source,
          processId,
        }));
      }
      ws?.close();
    };
  }, [source, processId, connectWs]);

  return { outLines, errLines, connected };
}
