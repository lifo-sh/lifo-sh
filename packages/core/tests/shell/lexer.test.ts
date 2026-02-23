import { describe, it, expect } from 'vitest';
import { lex } from '../../src/shell/lexer.js';
import { TokenKind } from '../../src/shell/types.js';

function kinds(input: string): TokenKind[] {
  return lex(input).map((t) => t.kind);
}

function values(input: string): string[] {
  return lex(input).filter((t) => t.kind !== TokenKind.EOF).map((t) => t.value);
}

describe('lexer', () => {
  it('lexes simple words', () => {
    expect(values('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });

  it('returns EOF for empty input', () => {
    const tokens = lex('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe(TokenKind.EOF);
  });

  it('returns EOF for whitespace-only input', () => {
    const tokens = lex('   \t  ');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe(TokenKind.EOF);
  });

  describe('pipes', () => {
    it('lexes pipe operator', () => {
      expect(kinds('a | b')).toEqual([TokenKind.Word, TokenKind.Pipe, TokenKind.Word, TokenKind.EOF]);
    });

    it('lexes pipe without spaces', () => {
      expect(values('a|b')).toEqual(['a', '|', 'b']);
    });
  });

  describe('redirections', () => {
    it('lexes > redirect', () => {
      expect(kinds('echo hi > out')).toEqual([
        TokenKind.Word, TokenKind.Word, TokenKind.RedirectOut, TokenKind.Word, TokenKind.EOF,
      ]);
    });

    it('lexes >> redirect', () => {
      expect(kinds('echo hi >> out')).toEqual([
        TokenKind.Word, TokenKind.Word, TokenKind.RedirectAppend, TokenKind.Word, TokenKind.EOF,
      ]);
    });

    it('lexes < redirect', () => {
      expect(kinds('cat < file')).toEqual([
        TokenKind.Word, TokenKind.RedirectIn, TokenKind.Word, TokenKind.EOF,
      ]);
    });

    it('lexes 2> redirect', () => {
      expect(kinds('cmd 2> err')).toEqual([
        TokenKind.Word, TokenKind.RedirectErr, TokenKind.Word, TokenKind.EOF,
      ]);
    });

    it('lexes 2>> redirect', () => {
      expect(kinds('cmd 2>> err')).toEqual([
        TokenKind.Word, TokenKind.RedirectErrAppend, TokenKind.Word, TokenKind.EOF,
      ]);
    });

    it('lexes &> redirect', () => {
      expect(kinds('cmd &> all')).toEqual([
        TokenKind.Word, TokenKind.RedirectAll, TokenKind.Word, TokenKind.EOF,
      ]);
    });
  });

  describe('chaining operators', () => {
    it('lexes &&', () => {
      expect(kinds('a && b')).toEqual([TokenKind.Word, TokenKind.And, TokenKind.Word, TokenKind.EOF]);
    });

    it('lexes ||', () => {
      expect(kinds('a || b')).toEqual([TokenKind.Word, TokenKind.Or, TokenKind.Word, TokenKind.EOF]);
    });

    it('lexes ;', () => {
      expect(kinds('a ; b')).toEqual([TokenKind.Word, TokenKind.Semi, TokenKind.Word, TokenKind.EOF]);
    });

    it('lexes &', () => {
      expect(kinds('a &')).toEqual([TokenKind.Word, TokenKind.Amp, TokenKind.EOF]);
    });
  });

  describe('quotes', () => {
    it('handles single quotes', () => {
      const tokens = lex("echo 'hello world'");
      const word = tokens.find((t) => t.parts?.some((p) => p.quoted === 'single'));
      expect(word).toBeDefined();
      expect(word!.value).toBe('hello world');
    });

    it('handles double quotes', () => {
      const tokens = lex('echo "hello world"');
      const word = tokens.find((t) => t.parts?.some((p) => p.quoted === 'double'));
      expect(word).toBeDefined();
      expect(word!.value).toBe('hello world');
    });

    it('handles mixed quotes in one word', () => {
      expect(values("echo 'hello'\" world\"")).toEqual(['echo', 'hello world']);
    });

    it('preserves quote type in parts', () => {
      const tokens = lex("'single'\"double\"plain");
      const word = tokens[0];
      expect(word.parts).toHaveLength(3);
      expect(word.parts![0].quoted).toBe('single');
      expect(word.parts![1].quoted).toBe('double');
      expect(word.parts![2].quoted).toBe('none');
    });
  });

  describe('escape characters', () => {
    it('handles backslash escapes', () => {
      expect(values('echo hello\\ world')).toEqual(['echo', 'hello world']);
    });

    it('handles escaped special chars', () => {
      expect(values('echo \\|')).toEqual(['echo', '|']);
    });
  });

  describe('comments', () => {
    it('ignores text after #', () => {
      expect(values('echo hi # comment')).toEqual(['echo', 'hi']);
    });

    it('handles # at start', () => {
      expect(values('# full comment')).toEqual([]);
    });
  });

  describe('command substitution', () => {
    it('captures $() in word', () => {
      expect(values('echo $(whoami)')).toEqual(['echo', '$(whoami)']);
    });

    it('handles nested parens', () => {
      expect(values('echo $(echo $(pwd))')).toEqual(['echo', '$(echo $(pwd))']);
    });
  });

  describe('complex inputs', () => {
    it('lexes combined redirect and pipe', () => {
      expect(values('cat < in | sort > out')).toEqual(['cat', '<', 'in', '|', 'sort', '>', 'out']);
    });

    it('lexes chained commands', () => {
      expect(values('mkdir foo && cd foo && pwd')).toEqual([
        'mkdir', 'foo', '&&', 'cd', 'foo', '&&', 'pwd',
      ]);
    });

    it('lexes semicolons without spaces', () => {
      expect(values('a;b;c')).toEqual(['a', ';', 'b', ';', 'c']);
    });

    it('lexes variables in words', () => {
      expect(values('echo $HOME')).toEqual(['echo', '$HOME']);
    });

    it('lexes variable in double quotes', () => {
      const word = lex('echo "$HOME/dir"')[1];
      expect(word.parts![0].quoted).toBe('double');
      expect(word.parts![0].text).toBe('$HOME/dir');
    });
  });
});
