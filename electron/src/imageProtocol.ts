/**
 * Custom protocol handler for `logos-image://<jobId>/<encoded-url>`.
 *
 * Replaces the Python `/api/images/{job_id}` proxy. Resolves the original URL
 * from the path, fetches with the job's auth cookies, and returns the bytes.
 *
 * Must be registered as privileged BEFORE app.whenReady, then wired with
 * protocol.handle() AFTER it.
 */

import { protocol, net } from 'electron';
import { fetchAuthenticatedImage } from './services/imageHelpers';
import { getJobAuth } from './services/jobs';

export const PROTOCOL = 'logos-image';

export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}

export function registerImageProtocol(): void {
  protocol.handle(PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      // logos-image://<jobId>/<encoded original URL>
      const jobId = url.hostname;
      const original = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

      const auth = getJobAuth(jobId);
      if (!auth) return new Response('Job not found', { status: 404 });

      const result = await fetchAuthenticatedImage(original, auth.baseUrl, auth.cookies);
      if (!result) return new Response('Failed to fetch image', { status: 502 });

      return new Response(result.bytes, {
        status: 200,
        headers: { 'Content-Type': result.contentType },
      });
    } catch (e) {
      console.error('[image-protocol] error:', e);
      return new Response('Bad request', { status: 400 });
    }
  });

  // Touch `net` to keep it imported (used implicitly by Response in some Electron versions).
  void net;
}
