import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const BOT_TOKEN = '7000000001:AAtest-bot-token-never-shown_x9';
export const ME = { id: 7000000001, is_bot: true, first_name: 'Mind Palace', username: 'mind_palace_test_bot' };
export const ADA = { id: 111, first_name: 'Ada', last_name: 'Lovelace' };
export const EVE = { id: 999, first_name: 'Eve' };
export type Person = typeof ADA | typeof EVE;

export interface Sent {
  method: 'sendMessage' | 'sendDocument';
  chat: number;
  text: string;
  file?: string;
}

/** A stand-in for api.telegram.org. It holds getUpdates open until a message comes, keeps what the service sends, and serves files. */
export class FakeBot {
  readonly calls: { method: string; body: Record<string, unknown> }[] = [];
  readonly sent: Sent[] = [];
  url = '';
  /** While set, getUpdates answers with this failure. */
  refuse: { status: number; description: string } | null = null;
  private readonly updates: { update_id: number; message: Record<string, unknown> }[] = [];
  private readonly files = new Map<string, { bytes: Uint8Array; tooBig?: boolean }>();
  private wake: (() => void)[] = [];
  private server: Server | null = null;
  private nextUpdate = 500;

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.answer(req, res).catch(() => res.destroy()));
    await new Promise<void>((ready) => this.server!.listen(0, '127.0.0.1', ready));
    const address = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${address.port}`;
    return this;
  }

  /** A message from `from`, in their private chat with the bot. Returns its update id. */
  push(from: Person, fields: Record<string, unknown>): number {
    const id = this.nextUpdate++;
    this.updates.push({ update_id: id, message: { message_id: id, from, chat: { id: from.id, type: 'private' }, date: 0, ...fields } });
    for (const wake of this.wake.splice(0)) wake();
    return id;
  }

  file(id: string, bytes: Uint8Array, tooBig = false): void {
    this.files.set(id, { bytes, tooBig });
  }

  /** Resolves once the service has asked for updates past `id`, so it has read that one. */
  read(id: number): Promise<void> {
    return this.until(() => this.calls.some((c) => c.method === 'getUpdates' && Number(c.body.offset) > id));
  }

  /** The first thing sent to `chat` that matches, from the `after`th sent on. */
  async reply(chat: number, match: RegExp, method: Sent['method'] = 'sendMessage', after = 0): Promise<Sent> {
    let hit: Sent | undefined;
    await this.until(() => Boolean((hit = this.sent.slice(after).find((s) => s.chat === chat && s.method === method && match.test(s.text)))));
    return hit!;
  }

  async until(ok: () => boolean, ms = 5000): Promise<void> {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error('timed out waiting on the stand-in Bot API');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  polls(): number {
    return this.calls.filter((c) => c.method === 'getUpdates').length;
  }

  async close(): Promise<void> {
    for (const wake of this.wake.splice(0)) wake();
    const server = this.server;
    this.server = null;
    server?.closeAllConnections();
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const download = /^\/file\/bot([^/]+)\/files\/(.+)$/.exec(path);
    if (download) {
      const file = download[1] === BOT_TOKEN ? this.files.get(download[2]!) : undefined;
      res.writeHead(file ? 200 : 404).end(file ? Buffer.from(file.bytes) : undefined);
      return;
    }
    const call = /^\/bot([^/]+)\/(\w+)$/.exec(path);
    if (!call || call[1] !== BOT_TOKEN) return send(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    const method = call[2]!;
    const type = req.headers['content-type'] ?? '';
    const body: Record<string, unknown> = type.startsWith('multipart/')
      ? Object.fromEntries(await new Response(raw, { headers: { 'content-type': type } }).formData())
      : raw.length > 0
        ? (JSON.parse(String(raw)) as Record<string, unknown>)
        : {};
    this.calls.push({ method, body });
    switch (method) {
      case 'getMe':
        return send(res, 200, { ok: true, result: ME });
      case 'getUpdates': {
        if (this.refuse) return send(res, this.refuse.status, { ok: false, error_code: this.refuse.status, description: this.refuse.description });
        const offset = Number(body.offset ?? 0);
        const ready = () => this.updates.filter((u) => u.update_id >= offset);
        if (ready().length === 0) await new Promise<void>((wake) => (this.wake.push(wake), setTimeout(wake, 100)));
        return send(res, 200, { ok: true, result: ready() });
      }
      case 'sendMessage':
        this.sent.push({ method, chat: Number(body.chat_id), text: String(body.text) });
        return send(res, 200, { ok: true, result: { message_id: 1 } });
      case 'sendDocument': {
        const document = body.document as File;
        this.sent.push({ method, chat: Number(body.chat_id), text: await document.text(), file: document.name });
        return send(res, 200, { ok: true, result: { message_id: 2 } });
      }
      case 'getFile': {
        const id = String(body.file_id);
        const file = this.files.get(id);
        if (!file) return send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
        if (file.tooBig) return send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: file is too big' });
        return send(res, 200, { ok: true, result: { file_id: id, file_size: file.bytes.length, file_path: `files/${id}` } });
      }
    }
    send(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
  }
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}
