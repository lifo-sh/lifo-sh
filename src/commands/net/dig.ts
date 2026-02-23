import type { Command } from '../types.js';

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
  Question?: Array<{ name: string; type: number }>;
}

const TYPE_MAP: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
};

const command: Command = async (ctx) => {
  let queryType = 'A';
  let domain: string | undefined;

  for (const arg of ctx.args) {
    if (arg.startsWith('-') || arg.startsWith('+')) continue;
    const upper = arg.toUpperCase();
    if (['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA'].includes(upper)) {
      queryType = upper;
    } else {
      domain = arg;
    }
  }

  if (!domain) {
    ctx.stderr.write('dig: missing domain\n');
    ctx.stderr.write('Usage: dig [type] domain\n');
    return 1;
  }

  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${queryType}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: ctx.signal,
    });

    if (!response.ok) {
      ctx.stderr.write(`dig: DNS query failed (HTTP ${response.status})\n`);
      return 1;
    }

    const data: DnsResponse = await response.json();

    ctx.stdout.write(`; <<>> BrowserOS dig <<>> ${queryType} ${domain}\n`);
    ctx.stdout.write(`;; Got answer:\n`);
    ctx.stdout.write(`;; ->>HEADER<<- status: ${data.Status === 0 ? 'NOERROR' : 'NXDOMAIN'}\n`);
    ctx.stdout.write(`\n`);

    if (data.Question && data.Question.length > 0) {
      ctx.stdout.write(`;; QUESTION SECTION:\n`);
      for (const q of data.Question) {
        ctx.stdout.write(`;${q.name}.\t\tIN\t${TYPE_MAP[q.type] ?? q.type}\n`);
      }
      ctx.stdout.write(`\n`);
    }

    if (data.Answer && data.Answer.length > 0) {
      ctx.stdout.write(`;; ANSWER SECTION:\n`);
      for (const ans of data.Answer) {
        const typeName = TYPE_MAP[ans.type] ?? String(ans.type);
        ctx.stdout.write(`${ans.name}.\t${ans.TTL}\tIN\t${typeName}\t${ans.data}\n`);
      }
      ctx.stdout.write(`\n`);
    } else {
      ctx.stdout.write(`;; No answers found.\n\n`);
    }

    ctx.stdout.write(`;; SERVER: dns.google\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      ctx.stderr.write(`dig: connection to DNS server failed\n`);
      ctx.stderr.write(`Note: This may be a CORS restriction or network issue.\n`);
    } else {
      ctx.stderr.write(`dig: ${msg}\n`);
    }
    return 1;
  }
};

export default command;
