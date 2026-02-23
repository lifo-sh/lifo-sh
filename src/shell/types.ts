// ─── Token types ───

export enum TokenKind {
  Word,
  Pipe,           // |
  And,            // &&
  Or,             // ||
  Semi,           // ;
  Amp,            // &
  RedirectOut,    // >
  RedirectAppend, // >>
  RedirectIn,     // <
  RedirectErr,    // 2>
  RedirectErrAppend, // 2>>
  RedirectAll,    // &>
  EOF,
}

export interface WordPart {
  text: string;
  quoted: 'none' | 'single' | 'double';
}

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
  parts?: WordPart[];  // only for Word tokens
}

// ─── AST node types ───

export interface ScriptNode {
  type: 'script';
  lists: ListNode[];
}

export interface ListNode {
  type: 'list';
  entries: Array<{
    pipeline: PipelineNode;
    connector: '&&' | '||' | null;
  }>;
  background: boolean;
}

export interface PipelineNode {
  type: 'pipeline';
  commands: SimpleCommandNode[];
  negated: boolean;
}

export interface SimpleCommandNode {
  type: 'simple_command';
  assignments: Array<{ name: string; value: WordPart[] }>;
  words: WordPart[][];          // each element = one arg (array of parts)
  redirections: RedirectionNode[];
}

export interface RedirectionNode {
  operator: '>' | '>>' | '<' | '2>' | '2>>' | '&>';
  target: WordPart[];
}

export type ASTNode = ScriptNode | ListNode | PipelineNode | SimpleCommandNode;
