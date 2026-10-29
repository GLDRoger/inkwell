import type { Services } from './services.ts';

type ShutdownOptions = { services: Pick<Services, 'close' | 'bus'>; closeHttp: () => Promise<void> | void };

/** Directly callable in tests. Initiate listener close before draining services. */
export async function shutdown({ services, closeHttp }: ShutdownOptions): Promise<void> {
  const httpClosed = Promise.resolve(closeHttp());
  // HTTP close waits for SSE connections, so terminate those before awaiting it.
  services.bus.close();
  const results = await Promise.allSettled([httpClosed, services.close()]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

export function installShutdown(options: ShutdownOptions): () => void {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    void shutdown(options).then(() => {
      clearTimeout(deadline); process.exit(0);
    }, error => {
      console.error('[inkwell] shutdown failed', error);
      clearTimeout(deadline); process.exit(1);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return () => { process.off('SIGTERM', stop); process.off('SIGINT', stop); };
}
