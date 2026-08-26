import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { listActiveTimers } from '$lib/server/events/repo';
import { subscribe } from '$lib/server/events/broadcast';

const PING_INTERVAL_MS = 25_000;

export const GET: RequestHandler = handler({
	run: ({ db }) => {
		let unsubscribe: (() => void) | undefined;
		let ping: ReturnType<typeof setInterval> | undefined;
		let closed = false;

		const stream = new ReadableStream<string>({
			start(controller) {
				const send = (event: string, data: unknown) => {
					if (closed) return;
					try {
						controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
					} catch {
						closed = true; // consumer went away between cancel and this write
					}
				};
				send('snapshot', {
					serverTime: new Date().toISOString(),
					activeTimers: listActiveTimers(db)
				});
				unsubscribe = subscribe((change) => {
					if (change.kind === 'reset') send('reset', { serverTime: new Date().toISOString() });
					else if (change.kind === 'baby')
						send('baby', { baby: change.baby, serverTime: new Date().toISOString() });
					else send('sync', { ...change, serverTime: new Date().toISOString() });
				});
				ping = setInterval(() => {
					if (!closed)
						try {
							controller.enqueue(`:ping\n\n`);
						} catch {
							closed = true;
						}
				}, PING_INTERVAL_MS);
			},
			cancel() {
				closed = true;
				unsubscribe?.();
				if (ping) clearInterval(ping);
			}
		});

		return new Response(stream.pipeThrough(new TextEncoderStream()), {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive'
			}
		});
	}
});
