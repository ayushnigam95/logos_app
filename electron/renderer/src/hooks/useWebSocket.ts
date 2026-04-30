/**
 * Job progress hook — subscribes to push events from the Electron main process.
 *
 * Originally a WebSocket hook; now wraps window.electronAPI.onJobProgress,
 * which is fed by jobEvents.emit('progress') in the main process.
 *
 * The name is preserved to minimise churn in App.tsx.
 */
import { useEffect, useState } from 'react';
import type { JobProgress } from '../types';

export function useWebSocket(jobId: string | null) {
  const [progress, setProgress] = useState<JobProgress | null>(null);

  useEffect(() => {
    setProgress(null);
    if (!jobId) return;
    if (!window.electronAPI) return;

    const unsubscribe = window.electronAPI.onJobProgress((p) => {
      const prog = p as JobProgress;
      // Filter to our job — main broadcasts to all renderers.
      if (prog.job_id === jobId) setProgress(prog);
    });

    return () => {
      unsubscribe();
    };
  }, [jobId]);

  return { progress, connected: !!jobId };
}
