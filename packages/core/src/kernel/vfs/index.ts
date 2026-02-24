export { VFS } from './VFS.js';
export { VFSError, ErrorCode } from './types.js';
export type { INode, ChunkRef, Stat, Dirent, FileType, ErrorCodeType, VirtualProvider, MountProvider, VFSWatchEvent, VFSWatchListener, VFSEventType } from './types.js';
export { NativeFsProvider } from './providers/NativeFsProvider.js';
export type { NativeFsModule } from './providers/NativeFsProvider.js';
export { getMimeType, getFileCategory, isBinaryMime } from '../../utils/mime.js';
