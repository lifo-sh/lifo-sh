import type { VFS } from '@lifo-sh/core';
import type { SessionEntry, SessionMetadata, ContentBlock } from './types.js';

const SESSIONS_DIR = '/home/user/.openclaw/sessions';
const SESSIONS_INDEX = '/home/user/.openclaw/sessions/index.json';

export class SessionManager {
  private vfs: VFS;
  private sessions: Map<string, SessionMetadata> = new Map();

  constructor(vfs: VFS) {
    this.vfs = vfs;
    this.ensureDirs();
    this.loadIndex();
  }

  private ensureDirs(): void {
    try { this.vfs.mkdir(SESSIONS_DIR, { recursive: true }); } catch { /* exists */ }
  }

  private loadIndex(): void {
    try {
      const raw = this.vfs.readFileString(SESSIONS_INDEX);
      const entries: SessionMetadata[] = JSON.parse(raw);
      for (const entry of entries) {
        this.sessions.set(entry.sessionId, entry);
      }
    } catch {
      // No index yet
    }
  }

  private saveIndex(): void {
    const entries = Array.from(this.sessions.values());
    this.vfs.writeFile(SESSIONS_INDEX, JSON.stringify(entries, null, 2));
  }

  private sessionPath(sessionId: string): string {
    return `${SESSIONS_DIR}/${sessionId}.jsonl`;
  }

  createSession(model: string, provider: string): string {
    const sessionId = crypto.randomUUID();
    const meta: SessionMetadata = {
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model,
      provider,
      totalTokens: 0,
      messageCount: 0,
    };
    this.sessions.set(sessionId, meta);
    this.vfs.writeFile(this.sessionPath(sessionId), '');
    this.saveIndex();
    return sessionId;
  }

  getOrCreateSession(model: string, provider: string): string {
    // Return most recent session for this model/provider, or create new
    let latest: SessionMetadata | undefined;
    for (const meta of this.sessions.values()) {
      if (meta.model === model && meta.provider === provider) {
        if (!latest || meta.updatedAt > latest.updatedAt) {
          latest = meta;
        }
      }
    }
    return latest?.sessionId || this.createSession(model, provider);
  }

  appendMessage(sessionId: string, entry: SessionEntry): void {
    const line = JSON.stringify(entry) + '\n';
    this.vfs.appendFile(this.sessionPath(sessionId), line);

    const meta = this.sessions.get(sessionId);
    if (meta) {
      meta.updatedAt = Date.now();
      meta.messageCount++;
      this.saveIndex();
    }
  }

  updateTokens(sessionId: string, tokens: number): void {
    const meta = this.sessions.get(sessionId);
    if (meta) {
      meta.totalTokens += tokens;
      this.saveIndex();
    }
  }

  loadMessages(sessionId: string): SessionEntry[] {
    try {
      const raw = this.vfs.readFileString(this.sessionPath(sessionId));
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /** Convert session history to Anthropic Messages API format */
  toApiMessages(sessionId: string): Array<{ role: string; content: string | ContentBlock[] }> {
    const entries = this.loadMessages(sessionId);
    return entries.map(e => ({
      role: e.role,
      content: e.content,
    }));
  }

  listSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteSession(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    this.sessions.delete(sessionId);
    try { this.vfs.unlink(this.sessionPath(sessionId)); } catch { /* ok */ }
    this.saveIndex();
    return true;
  }

  clearSession(sessionId: string): void {
    this.vfs.writeFile(this.sessionPath(sessionId), '');
    const meta = this.sessions.get(sessionId);
    if (meta) {
      meta.messageCount = 0;
      meta.totalTokens = 0;
      this.saveIndex();
    }
  }
}
