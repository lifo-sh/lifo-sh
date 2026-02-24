export type FileType = 'file' | 'directory';

export type VFSEventType = 'create' | 'modify' | 'delete' | 'rename';

export interface VFSWatchEvent {
  type: VFSEventType;
  path: string;
  oldPath?: string; // only for 'rename'
  fileType: FileType;
}

export type VFSWatchListener = (event: VFSWatchEvent) => void;

export interface INode {
  type: FileType;
  name: string;
  data: Uint8Array;         // file content (empty for dirs)
  children: Map<string, INode>;  // dir entries (empty map for files)
  ctime: number;
  mtime: number;
  mode: number;
}

export interface Stat {
  type: FileType;
  size: number;
  ctime: number;
  mtime: number;
  mode: number;
}

export interface Dirent {
  name: string;
  type: FileType;
}

export const ErrorCode = {
  ENOENT: 'ENOENT',
  EEXIST: 'EEXIST',
  ENOTDIR: 'ENOTDIR',
  EISDIR: 'EISDIR',
  ENOTEMPTY: 'ENOTEMPTY',
  EINVAL: 'EINVAL',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface VirtualProvider {
  readFile(subpath: string): Uint8Array;
  readFileString(subpath: string): string;
  writeFile?(subpath: string, content: string | Uint8Array): void;
  exists(subpath: string): boolean;
  stat(subpath: string): Stat;
  readdir(subpath: string): Dirent[];
}

export class VFSError extends Error {
  code: ErrorCodeType;

  constructor(code: ErrorCodeType, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'VFSError';
  }
}
