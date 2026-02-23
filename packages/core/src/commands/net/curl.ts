import type { Command } from '../types.js';
import { resolve } from '../../utils/path.js';
import type { VirtualRequestHandler } from '../../kernel/index.js';

function createCurlImpl(portRegistry?: Map<number, VirtualRequestHandler>): Command {
  return async (ctx) => {
    let method = 'GET';
    const headers: Record<string, string> = {};
    let data: string | undefined;
    let outputFile: string | undefined;
    let silent = false;
    let followRedirects = false;
    let headOnly = false;
    let url: string | undefined;

    // Manual arg parsing to support multiple -H flags
    const args = ctx.args;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '-X':
          method = args[++i] ?? 'GET';
          break;
        case '-H': {
          const header = args[++i] ?? '';
          const colonIdx = header.indexOf(':');
          if (colonIdx !== -1) {
            headers[header.slice(0, colonIdx).trim()] = header.slice(colonIdx + 1).trim();
          }
          break;
        }
        case '-d':
          data = args[++i] ?? '';
          if (method === 'GET') method = 'POST';
          break;
        case '-o':
          outputFile = args[++i] ?? '';
          break;
        case '-s':
        case '--silent':
          silent = true;
          break;
        case '-L':
        case '--location':
          followRedirects = true;
          break;
        case '-I':
        case '--head':
          headOnly = true;
          method = 'HEAD';
          break;
        default:
          if (!arg.startsWith('-')) {
            url = arg;
          }
          break;
      }
    }

    if (!url) {
      ctx.stderr.write('curl: no URL specified\n');
      ctx.stderr.write('Usage: curl [-X method] [-H header] [-d data] [-o file] [-s] [-L] [-I] url\n');
      return 1;
    }

    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    // Check for virtual server
    if (portRegistry) {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'http:' ? 80 : 443);

        if ((host === 'localhost' || host === '127.0.0.1') && portRegistry.has(port)) {
          const handler = portRegistry.get(port)!;
          const vReq = {
            method,
            url: parsed.pathname + parsed.search,
            headers,
            body: data || '',
          };
          const vRes = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            body: '',
          };

          handler(vReq, vRes);

          if (headOnly) {
            ctx.stdout.write(`HTTP/${vRes.statusCode} OK\n`);
            for (const [key, value] of Object.entries(vRes.headers)) {
              ctx.stdout.write(`${key}: ${value}\n`);
            }
            return 0;
          }

          const body = vRes.body;

          if (outputFile) {
            const path = resolve(ctx.cwd, outputFile);
            ctx.vfs.writeFile(path, body);
            if (!silent) {
              ctx.stderr.write(`  % Total    % Received\n`);
              ctx.stderr.write(`  ${body.length}    ${body.length}\n`);
            }
          } else {
            ctx.stdout.write(body);
            if (!body.endsWith('\n')) {
              ctx.stdout.write('\n');
            }
          }

          return vRes.statusCode >= 200 && vRes.statusCode < 400 ? 0 : 22;
        }
      } catch {
        // URL parse failed, fall through to real fetch
      }
    }

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: data,
        redirect: followRedirects ? 'follow' : 'manual',
        signal: ctx.signal,
      };

      const response = await fetch(url, fetchOptions);

      if (headOnly) {
        ctx.stdout.write(`HTTP/${response.status} ${response.statusText}\n`);
        response.headers.forEach((value, key) => {
          ctx.stdout.write(`${key}: ${value}\n`);
        });
        return 0;
      }

      const body = await response.text();

      if (outputFile) {
        const path = resolve(ctx.cwd, outputFile);
        ctx.vfs.writeFile(path, body);
        if (!silent) {
          ctx.stderr.write(`  % Total    % Received\n`);
          ctx.stderr.write(`  ${body.length}    ${body.length}\n`);
        }
      } else {
        ctx.stdout.write(body);
        if (!body.endsWith('\n')) {
          ctx.stdout.write('\n');
        }
      }

      return response.ok ? 0 : 22;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
        ctx.stderr.write(`curl: (7) Failed to connect to ${url}\n`);
        ctx.stderr.write(`Note: This may be a CORS restriction. The target server must allow cross-origin requests.\n`);
      } else {
        ctx.stderr.write(`curl: ${msg}\n`);
      }
      return 7;
    }
  };
}

export function createCurlCommand(portRegistry: Map<number, VirtualRequestHandler>): Command {
  return createCurlImpl(portRegistry);
}

// Default command (no port registry -- always uses fetch)
const command: Command = createCurlImpl();

export default command;
