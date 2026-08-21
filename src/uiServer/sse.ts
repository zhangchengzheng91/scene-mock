import { ServerResponse } from 'http';

export type SseEvent = 'reload' | 'error' | 'conflict';

export class SseHub {
  private clients = new Set<ServerResponse>();

  add(res: ServerResponse) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  send(event: SseEvent, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}
