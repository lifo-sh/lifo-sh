import { describe, it, expect } from 'vitest';
import { lex } from '../../src/shell/lexer.js';
import { parse } from '../../src/shell/parser.js';

function p(input: string) {
  return parse(lex(input));
}

describe('parser', () => {
  describe('simple commands', () => {
    it('parses a simple command', () => {
      const ast = p('echo hello');
      expect(ast.lists).toHaveLength(1);
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.words).toHaveLength(2);
      expect(cmd.words[0][0].text).toBe('echo');
      expect(cmd.words[1][0].text).toBe('hello');
    });

    it('parses empty input', () => {
      const ast = p('');
      expect(ast.lists).toHaveLength(0);
    });

    it('parses multiple arguments', () => {
      const ast = p('ls -la /tmp');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.words).toHaveLength(3);
    });
  });

  describe('pipelines', () => {
    it('parses a pipeline', () => {
      const ast = p('echo hello | cat');
      const pipeline = ast.lists[0].entries[0].pipeline;
      expect(pipeline.commands).toHaveLength(2);
      expect(pipeline.commands[0].words[0][0].text).toBe('echo');
      expect(pipeline.commands[1].words[0][0].text).toBe('cat');
    });

    it('parses multi-stage pipeline', () => {
      const ast = p('a | b | c');
      const pipeline = ast.lists[0].entries[0].pipeline;
      expect(pipeline.commands).toHaveLength(3);
    });

    it('parses negated pipeline', () => {
      const ast = p('! false');
      const pipeline = ast.lists[0].entries[0].pipeline;
      expect(pipeline.negated).toBe(true);
    });
  });

  describe('chaining', () => {
    it('parses && chain', () => {
      const ast = p('a && b');
      const list = ast.lists[0];
      expect(list.entries).toHaveLength(2);
      expect(list.entries[0].connector).toBe('&&');
      expect(list.entries[1].connector).toBeNull();
    });

    it('parses || chain', () => {
      const ast = p('a || b');
      const list = ast.lists[0];
      expect(list.entries[0].connector).toBe('||');
    });

    it('parses mixed && and ||', () => {
      const ast = p('a && b || c');
      const list = ast.lists[0];
      expect(list.entries).toHaveLength(3);
      expect(list.entries[0].connector).toBe('&&');
      expect(list.entries[1].connector).toBe('||');
    });
  });

  describe('semicolons', () => {
    it('parses semicolons as separate lists', () => {
      const ast = p('a ; b');
      expect(ast.lists).toHaveLength(2);
    });

    it('handles trailing semicolons', () => {
      const ast = p('a ;');
      expect(ast.lists).toHaveLength(1);
    });
  });

  describe('background', () => {
    it('parses background &', () => {
      const ast = p('sleep 10 &');
      expect(ast.lists[0].background).toBe(true);
    });

    it('non-background by default', () => {
      const ast = p('echo hi');
      expect(ast.lists[0].background).toBe(false);
    });
  });

  describe('redirections', () => {
    it('parses output redirect', () => {
      const ast = p('echo hi > out.txt');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.redirections).toHaveLength(1);
      expect(cmd.redirections[0].operator).toBe('>');
      expect(cmd.redirections[0].target[0].text).toBe('out.txt');
    });

    it('parses append redirect', () => {
      const ast = p('echo hi >> out.txt');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.redirections[0].operator).toBe('>>');
    });

    it('parses input redirect', () => {
      const ast = p('cat < in.txt');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.redirections[0].operator).toBe('<');
    });

    it('parses stderr redirect', () => {
      const ast = p('cmd 2> err.txt');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.redirections[0].operator).toBe('2>');
    });

    it('parses multiple redirections', () => {
      const ast = p('cmd > out 2> err');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.redirections).toHaveLength(2);
    });
  });

  describe('assignments', () => {
    it('parses variable assignment before command', () => {
      const ast = p('FOO=bar echo $FOO');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.assignments).toHaveLength(1);
      expect(cmd.assignments[0].name).toBe('FOO');
      expect(cmd.words).toHaveLength(2);
    });

    it('parses standalone assignment', () => {
      const ast = p('FOO=bar');
      const cmd = ast.lists[0].entries[0].pipeline.commands[0];
      expect(cmd.assignments).toHaveLength(1);
      expect(cmd.words).toHaveLength(0);
    });
  });

  describe('combined complex input', () => {
    it('parses cat < in | sort > out', () => {
      const ast = p('cat < in | sort > out');
      const pipeline = ast.lists[0].entries[0].pipeline;
      expect(pipeline.commands).toHaveLength(2);

      const cat = pipeline.commands[0];
      expect(cat.words[0][0].text).toBe('cat');
      expect(cat.redirections).toHaveLength(1);
      expect(cat.redirections[0].operator).toBe('<');

      const sort = pipeline.commands[1];
      expect(sort.words[0][0].text).toBe('sort');
      expect(sort.redirections).toHaveLength(1);
      expect(sort.redirections[0].operator).toBe('>');
    });

    it('parses chaining with pipes', () => {
      const ast = p('echo hi | cat && echo done');
      expect(ast.lists).toHaveLength(1);
      const list = ast.lists[0];
      expect(list.entries).toHaveLength(2);
      expect(list.entries[0].pipeline.commands).toHaveLength(2);
      expect(list.entries[1].pipeline.commands).toHaveLength(1);
    });
  });
});
