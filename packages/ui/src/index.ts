export { Terminal } from './Terminal.js';
export { FileExplorer } from './FileExplorer.js';
export type { FileExplorerOptions, FileExplorerEntry, FileExplorerEvent, EditorProvider, EditorInstance } from './FileExplorer.js';
export { KanbanBoard } from './KanbanBoard.js';
export type { KanbanBoardOptions, KanbanBoardEvent, KanbanTask, KanbanAssignee, KanbanStatus, KanbanPriority, KanbanActivity, KanbanDeliverable } from './KanbanBoard.js';
// Re-export ITerminal type from core for convenience
export type { ITerminal } from '@lifo-sh/core';
