/**
 * Session folder management
 * Organize sessions into folders like ChatGPT Desktop
 */

export interface SessionFolder {
  id: string;
  name: string;
  color?: string; // Optional accent color
  createdAt: number;
  updatedAt: number;
  order: number; // For custom sorting
}

export interface SessionFolderAssignment {
  sessionId: string;
  folderId: string | null; // null = uncategorized/root
  order: number; // Order within the folder
}

const FOLDERS_KEY = 'session_folders';
const ASSIGNMENTS_KEY = 'session_folder_assignments';

/**
 * Load all folders from localStorage
 */
export function loadFolders(): SessionFolder[] {
  try {
    const data = localStorage.getItem(FOLDERS_KEY);
    if (!data) return [];
    return JSON.parse(data) as SessionFolder[];
  } catch (err) {
    console.error('Failed to load session folders:', err);
    return [];
  }
}

/**
 * Save folders to localStorage
 */
export function saveFolders(folders: SessionFolder[]): void {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch (err) {
    console.error('Failed to save session folders:', err);
  }
}

/**
 * Load session-folder assignments
 */
export function loadAssignments(): SessionFolderAssignment[] {
  try {
    const data = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!data) return [];
    return JSON.parse(data) as SessionFolderAssignment[];
  } catch (err) {
    console.error('Failed to load session folder assignments:', err);
    return [];
  }
}

/**
 * Save assignments to localStorage
 */
export function saveAssignments(assignments: SessionFolderAssignment[]): void {
  try {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch (err) {
    console.error('Failed to save session folder assignments:', err);
  }
}

/**
 * Create a new folder
 */
export function createFolder(name: string, color?: string): SessionFolder {
  const folders = loadFolders();
  const now = Date.now();
  const newFolder: SessionFolder = {
    id: `folder_${now}_${Math.random().toString(36).slice(2, 9)}`,
    name,
    color,
    createdAt: now,
    updatedAt: now,
    order: folders.length,
  };
  folders.push(newFolder);
  saveFolders(folders);
  return newFolder;
}

/**
 * Rename a folder
 */
export function renameFolder(folderId: string, newName: string): void {
  const folders = loadFolders();
  const folder = folders.find(f => f.id === folderId);
  if (folder) {
    folder.name = newName;
    folder.updatedAt = Date.now();
    saveFolders(folders);
  }
}

/**
 * Delete a folder (moves sessions to uncategorized)
 */
export function deleteFolder(folderId: string): void {
  const folders = loadFolders().filter(f => f.id !== folderId);
  saveFolders(folders);

  // Move all sessions in this folder to uncategorized
  const assignments = loadAssignments();
  const updated = assignments.map(a =>
    a.folderId === folderId ? { ...a, folderId: null } : a
  );
  saveAssignments(updated);
}

/**
 * Assign a session to a folder
 */
export function assignSessionToFolder(sessionId: string, folderId: string | null): void {
  const assignments = loadAssignments();
  const existing = assignments.find(a => a.sessionId === sessionId);

  if (existing) {
    existing.folderId = folderId;
  } else {
    assignments.push({
      sessionId,
      folderId,
      order: 0,
    });
  }

  saveAssignments(assignments);
}

/**
 * Get folder for a session
 */
export function getSessionFolder(sessionId: string): string | null {
  const assignments = loadAssignments();
  const assignment = assignments.find(a => a.sessionId === sessionId);
  return assignment?.folderId ?? null;
}

/**
 * Get all sessions in a folder
 */
export function getSessionsInFolder(folderId: string | null): string[] {
  const assignments = loadAssignments();
  return assignments
    .filter(a => a.folderId === folderId)
    .sort((a, b) => a.order - b.order)
    .map(a => a.sessionId);
}

/**
 * Reorder folders
 */
export function reorderFolders(folderIds: string[]): void {
  const folders = loadFolders();
  const folderMap = new Map(folders.map(f => [f.id, f]));

  const reordered = folderIds.map((id, index) => {
    const folder = folderMap.get(id);
    if (folder) {
      folder.order = index;
      return folder;
    }
    return null;
  }).filter(Boolean) as SessionFolder[];

  saveFolders(reordered);
}
