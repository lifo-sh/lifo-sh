import {
  TokenKind,
  type Token,
  type ScriptNode,
  type ListNode,
  type PipelineNode,
  type SimpleCommandNode,
  type RedirectionNode,
  type WordPart,
} from './types.js';

export class ParseError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parse(tokens: Token[]): ScriptNode {
  const parser = new Parser(tokens);
  return parser.parseScript();
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.EOF, value: '', pos: -1 };
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== TokenKind.EOF) {
      this.pos++;
    }
    return token;
  }

  private expect(kind: TokenKind): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new ParseError(
        `Expected ${TokenKind[kind]} but got ${TokenKind[token.kind]} ('${token.value}')`,
        token.pos,
      );
    }
    return this.advance();
  }

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.EOF;
  }

  parseScript(): ScriptNode {
    const lists: ListNode[] = [];

    // Skip leading separators
    this.skipSeparators();

    while (!this.isAtEnd()) {
      lists.push(this.parseList());
      this.skipSeparators();
    }

    return { type: 'script', lists };
  }

  private skipSeparators(): void {
    while (this.peek().kind === TokenKind.Semi) {
      this.advance();
    }
  }

  private parseList(): ListNode {
    const entries: ListNode['entries'] = [];
    let background = false;

    // First pipeline
    const firstPipeline = this.parsePipeline();
    entries.push({ pipeline: firstPipeline, connector: null });

    // Chained pipelines with && or ||
    while (this.peek().kind === TokenKind.And || this.peek().kind === TokenKind.Or) {
      const connectorToken = this.advance();
      const connector = connectorToken.value as '&&' | '||';
      // Update the previous entry's connector
      entries[entries.length - 1].connector = connector;
      const pipeline = this.parsePipeline();
      entries.push({ pipeline, connector: null });
    }

    // Check for background &
    if (this.peek().kind === TokenKind.Amp) {
      this.advance();
      background = true;
    }

    return { type: 'list', entries, background };
  }

  private parsePipeline(): PipelineNode {
    let negated = false;

    // Check for ! prefix
    if (this.peek().kind === TokenKind.Word && this.peek().value === '!') {
      negated = true;
      this.advance();
    }

    const commands: SimpleCommandNode[] = [];
    commands.push(this.parseSimpleCommand());

    while (this.peek().kind === TokenKind.Pipe) {
      this.advance();
      commands.push(this.parseSimpleCommand());
    }

    return { type: 'pipeline', commands, negated };
  }

  private parseSimpleCommand(): SimpleCommandNode {
    const assignments: SimpleCommandNode['assignments'] = [];
    const words: WordPart[][] = [];
    const redirections: RedirectionNode[] = [];

    while (!this.isAtEnd()) {
      const token = this.peek();

      // Check for redirections
      if (this.isRedirectOperator(token.kind)) {
        const operator = this.advance().value as RedirectionNode['operator'];
        const targetToken = this.expect(TokenKind.Word);
        redirections.push({
          operator,
          target: targetToken.parts ?? [{ text: targetToken.value, quoted: 'none' }],
        });
        continue;
      }

      // Check for word tokens
      if (token.kind === TokenKind.Word) {
        // Check for VAR=value assignment (only before any regular words)
        if (words.length === 0) {
          const eqIdx = token.value.indexOf('=');
          if (eqIdx > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token.value.slice(0, eqIdx))) {
            this.advance();
            const name = token.value.slice(0, eqIdx);
            const valText = token.value.slice(eqIdx + 1);
            // Build value parts from the assignment
            const valueParts: WordPart[] = [];
            if (token.parts) {
              // Reconstruct parts after the =
              let consumed = 0;
              for (const part of token.parts) {
                const partEnd = consumed + part.text.length;
                if (partEnd <= eqIdx + 1) {
                  consumed = partEnd;
                  continue;
                }
                if (consumed < eqIdx + 1) {
                  // Part spans the =
                  valueParts.push({ text: part.text.slice(eqIdx + 1 - consumed), quoted: part.quoted });
                } else {
                  valueParts.push(part);
                }
                consumed = partEnd;
              }
            }
            if (valueParts.length === 0) {
              valueParts.push({ text: valText, quoted: 'none' });
            }
            assignments.push({ name, value: valueParts });
            continue;
          }
        }

        this.advance();
        const parts = token.parts ?? [{ text: token.value, quoted: 'none' }];
        words.push(parts);
        continue;
      }

      // Anything else (operator) ends this command
      break;
    }

    return { type: 'simple_command', assignments, words, redirections };
  }

  private isRedirectOperator(kind: TokenKind): boolean {
    return kind === TokenKind.RedirectOut
      || kind === TokenKind.RedirectAppend
      || kind === TokenKind.RedirectIn
      || kind === TokenKind.RedirectErr
      || kind === TokenKind.RedirectErrAppend
      || kind === TokenKind.RedirectAll;
  }
}
