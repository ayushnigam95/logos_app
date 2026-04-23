import { useEffect, useRef, useCallback, useState } from 'react';
import type { JobProgress } from '../types';

export function useWebSocket(jobId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [connected, setConnected] = useState(false);

  // Reset progress when jobId changes
  useEffect(() => {
    setProgress(null);
    setConnected(false);
  }, [jobId]);

  const connect = useCallback(() => {
    if (!jobId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/jobs/${jobId}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s if job isn't done
      if (progress?.status !== 'completed' && progress?.status !== 'failed') {
        setTimeout(connect, 2000);
      }
    };
    ws.onmessage = (event) => {
      try {
        const data: JobProgress = JSON.parse(event.data);
        setProgress(data);
      } catch {
        // ignore non-JSON messages
      }
    };

    wsRef.current = ws;
  }, [jobId, progress?.status]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  // Ping to keep alive
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      wsRef.current?.send('ping');
    }, 30000);
    return () => clearInterval(interval);
  }, [connected]);

  return { progress, connected };
}
