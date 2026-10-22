<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useSessionStore } from '../stores/session';
import { 
  getGlobalSessions, 
  canPickFolder, 
  pickFolder, 
  deleteSessionFile, 
  deleteWorkspaceFolder,
  loadKvStore,
  type KVStore
} from '../lib/host';
import type { GlobalSessionSummary } from '../lib/types';
const emit = defineEmits<{
  (e: 'newChat'): void;
  (e: 'newProjectChat', cwd: string): void;
}>();

const customProjectCwds = ref<string[]>([]);

const sessionStore = useSessionStore();
const globalSessions = ref<GlobalSessionSummary[]>([]);
let store: KVStore | null = null;
const deletedSessionIds = ref<Set<string>>(new Set());
const deletedWorkspaces = ref<Set<string>>(new Set());

const loading = ref(false);
const expandedFolders = ref<Set<string>>(new Set());
const searchQuery = ref('');

/**
 * Filter out raw NerdFont / unicode emoji icons from raw session titles
 * so the list presents clean, high-end typography with custom SVG icons.
 */
function cleanSessionTitle(title: string): string {
  if (!title) return '未命名会话';
  const stripped = title.replace(/^[\p{Emoji}\uFE0F\u200D\s]+/u, '').trim();
  return stripped || title;
}

function isTmpCwd(cwd: string | null): boolean {
  if (!cwd) return true;
  const lower = cwd.toLowerCase();
  return lower.includes('temp') || lower.includes('tmp') || lower === '-' || lower === '';
}

function getFolderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.pop() || cwd;
}

const currentSessionId = computed(() => 
  sessionStore.currentSession?.sessionId || sessionStore.currentSession?.id || null
);

// Group non-tmp sessions by project folder
const projectGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const map = new Map<string, { cwd: string; name: string; sessions: GlobalSessionSummary[] }>();

  // Include user-added custom project folders
  for (const c of customProjectCwds.value) {
    map.set(c, {
      cwd: c,
      name: getFolderName(c),
      sessions: [],
    });
  }
  for (const s of globalSessions.value) {
    if (isTmpCwd(s.cwd)) continue;
    if (deletedSessionIds.value.has(s.session_id)) continue;
    const cwd = s.cwd!;
    if (deletedWorkspaces.value.has(cwd)) continue;
    if (q) {
      const match = s.title.toLowerCase().includes(q) || cwd.toLowerCase().includes(q);
      if (!match) continue;
    }

    if (!map.has(cwd)) {
      map.set(cwd, {
        cwd,
        name: getFolderName(cwd),
        sessions: [],
      });
    }
    map.get(cwd)!.sessions.push(s);
  }

  // Include currently active session if in a project and not yet in history.db
  if (sessionStore.currentSession?.cwd && !isTmpCwd(sessionStore.currentSession.cwd)) {
    const curCwd = sessionStore.currentSession.cwd;
    if (!deletedWorkspaces.value.has(curCwd)) {
      if (!map.has(curCwd)) {
        map.set(curCwd, {
          cwd: curCwd,
          name: getFolderName(curCwd),
          sessions: [],
        });
      }
      const curSid = sessionStore.currentSession.sessionId || sessionStore.currentSession.id;
      if (curSid && !deletedSessionIds.value.has(curSid)) {
        const exists = map.get(curCwd)!.sessions.some(s => s.session_id === curSid);
        if (!exists) {
          map.get(curCwd)!.sessions.unshift({
            session_id: curSid,
            title: sessionStore.currentSession.title || '新会话',
            updated_at: Math.floor(sessionStore.currentSession.lastUpdated / 1000),
            cwd: curCwd,
            recap: null,
            bound_account: null,
            bound_provider: null,
            has_entity_file: true,
            file_path: null,
          });
        }
      }
    }
  }

  // Sort projects by latest updated session
  return Array.from(map.values()).sort((a, b) => {
    const aLatest = a.sessions[0]?.updated_at || 0;
    const bLatest = b.sessions[0]?.updated_at || 0;
    return bLatest - aLatest;
  });
});

// Recent sessions (omp default tmp directory)
const recentSessions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return globalSessions.value.filter((s) => {
    if (!isTmpCwd(s.cwd)) return false;
    if (deletedSessionIds.value.has(s.session_id)) return false;
    if (q) {
      return s.title.toLowerCase().includes(q);
    }
    return true;
  });
});
function toggleFolder(cwd: string) {
  if (expandedFolders.value.has(cwd)) {
    expandedFolders.value.delete(cwd);
  } else {
    expandedFolders.value.add(cwd);
  }
}

async function loadSessions() {
  loading.value = true;
  try {
    const list = await getGlobalSessions();
    globalSessions.value = list;

    // Auto-expand projects that have sessions
    if (list.length > 0 && expandedFolders.value.size === 0) {
      for (const s of list) {
        if (s.cwd && !isTmpCwd(s.cwd)) {
          expandedFolders.value.add(s.cwd);
          if (expandedFolders.value.size >= 3) break;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load sessions in sidebar:', err);
  } finally {
    loading.value = false;
  }
}

async function handleSelectSession(session: GlobalSessionSummary) {
  try {
    await sessionStore.loadHistoricalSession(session);
  } catch (err) {
    alert('无法加载该会话历史记录（实体文件可能已被移动或删除）');
  }
}

function handleNewChat() {
  sessionStore.startNewChat();
  emit('newChat');
}

async function handleCreateProjectWorkspace() {
  let targetFolder: string | null = null;
  if (canPickFolder()) {
    targetFolder = await pickFolder('选择要在其中创建工作区/项目的文件夹');
  } else {
    targetFolder = prompt('请输入工作区文件夹绝对路径 (如 D:\\Project\\my-new-app):');
  }

  if (targetFolder && targetFolder.trim()) {
    const cleanPath = targetFolder.trim();
    if (!customProjectCwds.value.includes(cleanPath)) {
      customProjectCwds.value.push(cleanPath);
    }
    expandedFolders.value.add(cleanPath);
    emit('newProjectChat', cleanPath);
  }
}
function handleCreateProjectSession(cwd: string) {
  expandedFolders.value.add(cwd);
  emit('newProjectChat', cwd);
}
// Auto-expand folder when currentSession changes to that project
watch(() => sessionStore.currentSession?.cwd, (newCwd) => {
  if (newCwd && !isTmpCwd(newCwd)) {
    expandedFolders.value.add(newCwd);
  }
}, { immediate: true });

// Refresh session list when prompt completes or session changes
watch(() => sessionStore.isLoading, (loading, prev) => {
  if (prev === true && loading === false) {
    loadSessions();
  }
});

const pendingDelete = ref<{
  type: 'session' | 'workspace';
  title: string;
  session?: GlobalSessionSummary;
  workspace?: { cwd: string; name: string; sessions: GlobalSessionSummary[] };
} | null>(null);

function confirmDeleteSession(session: GlobalSessionSummary) {
  pendingDelete.value = {
    type: 'session',
    title: cleanSessionTitle(session.title),
    session,
  };
}

function confirmDeleteWorkspace(group: { cwd: string; name: string; sessions: GlobalSessionSummary[] }) {
  pendingDelete.value = {
    type: 'workspace',
    title: group.name,
    workspace: group,
  };
}

function cancelDelete() {
  pendingDelete.value = null;
}

async function executeDelete() {
  if (!pendingDelete.value) return;

  if (pendingDelete.value.type === 'session' && pendingDelete.value.session) {
    const s = pendingDelete.value.session;
    deletedSessionIds.value.add(s.session_id);
    if (store) {
      await store.set('deleted_session_ids', Array.from(deletedSessionIds.value));
      await store.save();
    }
    try {
      await deleteSessionFile(s.session_id, s.cwd, s.file_path);
    } catch (e) {
      console.warn('Failed to delete session file:', e);
    }
    if (
      sessionStore.currentSession?.sessionId === s.session_id ||
      sessionStore.currentSession?.id === s.session_id
    ) {
      sessionStore.startNewChat();
    }
  } else if (pendingDelete.value.type === 'workspace' && pendingDelete.value.workspace) {
    const w = pendingDelete.value.workspace;
    deletedWorkspaces.value.add(w.cwd);
    for (const s of w.sessions) {
      deletedSessionIds.value.add(s.session_id);
    }
    if (store) {
      await store.set('deleted_workspaces', Array.from(deletedWorkspaces.value));
      await store.set('deleted_session_ids', Array.from(deletedSessionIds.value));
      await store.save();
    }
    try {
      await deleteWorkspaceFolder(w.cwd);
    } catch (e) {
      console.warn('Failed to delete workspace folder:', e);
    }
    if (sessionStore.currentSession?.cwd === w.cwd) {
      sessionStore.startNewChat();
    }
  }

  pendingDelete.value = null;
}

onMounted(async () => {
  try {
    store = await loadKvStore('omp_session_mgr');
    const savedDeletedSessions = await store.get<string[]>('deleted_session_ids');
    if (savedDeletedSessions && Array.isArray(savedDeletedSessions)) {
      deletedSessionIds.value = new Set(savedDeletedSessions);
    }
    const savedDeletedWorkspaces = await store.get<string[]>('deleted_workspaces');
    if (savedDeletedWorkspaces && Array.isArray(savedDeletedWorkspaces)) {
      deletedWorkspaces.value = new Set(savedDeletedWorkspaces);
    }
  } catch (e) {
    console.warn('Failed to initialize session manager store:', e);
  }
  loadSessions();
});
</script>

<template>
  <div class="session-sidebar-tree">
    <!-- Top New Chat Action Button (Codex / Modern style) -->
    <button class="new-chat-btn" @click="handleNewChat" title="新建会话">
      <svg class="new-chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
      <span>新聊天</span>
    </button>

    <!-- Search filter input if sessions exist -->
    <div v-if="globalSessions.length > 4" class="search-container">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input 
        v-model="searchQuery" 
        type="text" 
        placeholder="搜索会话..." 
        class="search-input"
      />
      <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">✕</button>
    </div>

    <!-- Tree Content Area -->
    <div class="tree-scroll-pane">
      <div v-if="loading && globalSessions.length === 0" class="loading-box">
        <span class="spinner"></span>
        <span>加载历史记录...</span>
      </div>

      <template v-else>
        <!-- Section 1: 项目 (Projects) -->
        <div v-if="projectGroups.length > 0" class="section-group">
          <div class="section-heading">
            <div class="heading-title-group">
              <span class="heading-title">项目</span>
              <span class="heading-badge">{{ projectGroups.length }}</span>
            </div>
            <!-- Create Project Workspace Button -->
            <button 
              class="create-workspace-btn" 
              @click="handleCreateProjectWorkspace" 
              title="选择文件夹创建或打开工作区"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>创建工作区</span>
            </button>
          </div>
          <div 
            v-for="group in projectGroups" 
            :key="group.cwd"
            class="folder-group-item"
          >
            <!-- Folder Header -->
            <!-- Folder Header with Delete Action -->
            <div class="folder-header-row">
              <button 
                class="folder-toggle-btn"
                @click="toggleFolder(group.cwd)"
                :title="group.cwd"
              >
                <div class="folder-title-left">
                  <!-- Custom SVG Chevron -->
                  <svg 
                    class="chevron-svg" 
                    :class="{ 'expanded': expandedFolders.has(group.cwd) }"
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    stroke-width="2.2" 
                    stroke-linecap="round" 
                    stroke-linejoin="round"
                    width="10" 
                    height="10"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>

                  <!-- Custom Vector Folder Icon (No NerdFont) -->
                  <svg class="folder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>

                  <span class="folder-label">{{ group.name }}</span>
                </div>
                <span class="folder-count-badge">{{ group.sessions.length }}</span>
              </button>

              <div class="folder-actions-right">
                <!-- Add Session in this Project Button -->
                <button 
                  class="row-action-btn folder-add-btn"
                  @click.stop="handleCreateProjectSession(group.cwd)"
                  title="在此项目/工作区创建新会话"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>

                <!-- Delete Workspace Button -->
                <button 
                  class="row-delete-btn folder-delete-btn"
                  @click.stop="confirmDeleteWorkspace(group)"
                  title="删除工作区及全部会话"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Sessions under this project folder -->
            <div v-if="expandedFolders.has(group.cwd)" class="folder-sessions-container">
              <div
                v-for="session in group.sessions"
                :key="session.session_id"
                class="session-row-wrapper"
                :class="{ 'active': session.session_id === currentSessionId }"
              >
                <button
                  class="session-row"
                  @click="handleSelectSession(session)"
                  :title="session.title"
                >
                  <!-- Custom Speech Bubble Icon -->
                  <svg class="session-bubble-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span class="session-text">{{ cleanSessionTitle(session.title) }}</span>
                </button>
                <button
                  class="row-delete-btn session-delete-btn"
                  @click.stop="confirmDeleteSession(session)"
                  title="删除会话"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="11" height="11">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 2: 最近 (Recent) - Omp default tmp folder sessions -->
        <div v-if="recentSessions.length > 0" class="section-group">
          <div class="section-heading">
            <span class="heading-title">最近</span>
            <span class="heading-badge">{{ recentSessions.length }}</span>
          </div>

          <div class="recent-sessions-container">
            <div
              v-for="session in recentSessions"
              :key="session.session_id"
              class="session-row-wrapper"
              :class="{ 'active': session.session_id === currentSessionId }"
            >
              <button
                class="session-row"
                @click="handleSelectSession(session)"
                :title="session.title"
              >
                <!-- Custom Speech Bubble Icon -->
                <svg class="session-bubble-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span class="session-text">{{ cleanSessionTitle(session.title) }}</span>
              </button>
              <button
                class="row-delete-btn session-delete-btn"
                @click.stop="confirmDeleteSession(session)"
                title="删除会话"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="11" height="11">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Empty State -->
      <div v-if="!loading && projectGroups.length === 0 && recentSessions.length === 0" class="empty-state">
        <p>暂无会话记录</p>
      </div>
    </div>

    <!-- Nocturne Glass Confirm Delete Dialog (100% in-place, zero glitch, no alert box) -->
    <div v-if="pendingDelete" class="delete-dialog-overlay" @click.self="cancelDelete">
      <div class="delete-dialog-card glass-card">
        <div class="delete-dialog-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>
        <h4 class="delete-dialog-title">
          {{ pendingDelete.type === 'session' ? '确认删除此会话？' : '确认删除此工作区？' }}
        </h4>
        <p class="delete-dialog-desc">
          您即将删除 <span class="delete-highlight">"{{ pendingDelete.title }}"</span>。<br />
          {{ pendingDelete.type === 'session' ? '此操作将从列表中移除并物理删除本地记录文件，无法恢复。' : '此操作将从列表中移除该工作区及其下属全部会话，无法恢复。' }}
        </p>
        <div class="delete-dialog-actions">
          <button class="dialog-cancel-btn glass-btn" @click="cancelDelete">
            取消
          </button>
          <button class="dialog-confirm-danger-btn" @click="executeDelete">
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-sidebar-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0.65rem 0.5rem 0.5rem 0.5rem;
  overflow: hidden;
}

/* Modern "新聊天" Action Button (Clean, airy, matching Codex reference) */
.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.7rem 1.15rem;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  color: #FFFFFF;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: all 300ms ease;
  margin-bottom: 0.85rem;
  flex-shrink: 0;
}

.new-chat-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(228, 184, 99, 0.45);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.55), 0 0 14px rgba(228, 184, 99, 0.20);
}

.new-chat-icon {
  color: #E4B863;
  flex-shrink: 0;
}

/* Search Box */
.search-container {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 0.85rem;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 0.4rem 1.8rem 0.4rem 2.1rem;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 12px;
  color: #FFFFFF;
  font-size: 0.8rem;
  box-shadow: none !important;
  transition: all 250ms ease;
}

.search-input:focus {
  outline: none;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(228, 184, 99, 0.35);
}

.clear-btn {
  position: absolute;
  right: 0.5rem;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.7rem;
  cursor: pointer;
}

/* Scroll Pane */
.tree-scroll-pane {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-right: 0.15rem;
}

.loading-box, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.8rem;
  gap: 0.5rem;
}

.section-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

/* Section Header (Spacious, elegant, unobtrusive) */
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.65rem 0.35rem 0.65rem;
}
.heading-title-group {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.heading-title {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.40);
  text-transform: uppercase;
}

.heading-badge {
  font-size: 0.68rem;
  padding: 0.05rem 0.4rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.35);
  font-family: var(--font-mono);
}

.create-workspace-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  border-radius: 8px;
  background: rgba(228, 184, 99, 0.12);
  border: 1px solid rgba(228, 184, 99, 0.30);
  color: #F3DCA8;
  font-size: 0.68rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 250ms ease;
}

.create-workspace-btn:hover {
  background: rgba(228, 184, 99, 0.20);
  border-color: rgba(228, 184, 99, 0.50);
  transform: translateY(-0.5px);
}
/* Folder Group */
.folder-group-item {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.15rem;
}

.folder-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 12px;
  transition: all 250ms ease;
}

.folder-header-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.folder-toggle-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.65rem;
  background: transparent;
  border: none;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.825rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 250ms ease;
  text-align: left;
}

.folder-toggle-btn:hover {
  color: #FFFFFF;
}

.folder-title-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.chevron-svg {
  color: rgba(255, 255, 255, 0.35);
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.chevron-svg.expanded {
  transform: rotate(90deg);
}

.folder-svg {
  color: #7C9CC4; /* Moonlight steel blue */
  flex-shrink: 0;
}

.folder-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-count-badge {
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.30);
  font-family: var(--font-mono);
  margin-left: 0.4rem;
}
.folder-actions-right {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-right: 0.35rem;
  flex-shrink: 0;
}

.folder-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #E4B863;
  opacity: 0.85;
  cursor: pointer;
  transition: var(--transition-spring);
}

.folder-header-row:hover .folder-add-btn {
  opacity: 1;
}

.folder-add-btn:hover {
  background: rgba(228, 184, 99, 0.22);
  border-color: rgba(228, 184, 99, 0.50);
  color: #F3DCA8;
  transform: scale(1.1);
}

/* Sessions inside Folder */
.folder-sessions-container {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-left: 1.15rem;
  margin-top: 0.15rem;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  margin-left: 0.9rem;
}

.recent-sessions-container {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

/* Session Row Item */
.session-row-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  width: 100%;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: all 250ms ease;
  min-height: 34px;
}

.session-row-wrapper:hover {
  background: rgba(255, 255, 255, 0.06);
}

.session-row-wrapper.active {
  background: rgba(228, 184, 99, 0.12);
  border-color: rgba(228, 184, 99, 0.30);
  box-shadow: inset 0 1px 0 rgba(243, 220, 168, 0.20);
}

.session-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.48rem 0.65rem;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.70);
  font-size: 0.8rem;
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
  transition: all 250ms ease;
}

.session-row-wrapper:hover .session-row {
  color: #FFFFFF;
  transform: translateX(1px);
}

.session-row-wrapper.active .session-row {
  color: #F3DCA8;
  font-weight: 500;
}

.row-delete-btn {
  opacity: 0;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  transition: all 200ms ease;
  flex-shrink: 0;
  margin-right: 0.35rem;
}

.folder-header-row:hover .row-delete-btn,
.session-row-wrapper:hover .row-delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.row-delete-btn:hover {
  background: rgba(248, 113, 113, 0.20);
  color: #F87171;
}
.session-bubble-svg {
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
  transition: color 250ms ease;
}

.session-row:hover .session-bubble-svg {
  color: rgba(255, 255, 255, 0.70);
}

.session-row.active .session-bubble-svg {
  color: #E4B863;
}

.session-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Delete Confirmation Modal (Nocturne Glassmorphism) */
.delete-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(3, 7, 18, 0.75);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.delete-dialog-card {
  width: 100%;
  max-width: 420px;
  background: rgba(11, 19, 34, 0.95);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(248, 113, 113, 0.30);
  border-radius: 24px;
  padding: 1.75rem;
  box-shadow: 0 24px 64px rgba(3, 7, 18, 0.8), 0 0 24px rgba(248, 113, 113, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.20);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.85rem;
  animation: dialog-pop 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.delete-dialog-icon {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: rgba(248, 113, 113, 0.15);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #F87171;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.25rem;
}

.delete-dialog-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: #FFFFFF;
  margin: 0;
}

.delete-dialog-desc {
  font-size: 0.825rem;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.55;
  margin: 0;
}

.delete-highlight {
  color: #FCA5A5;
  font-weight: 500;
}

.delete-dialog-actions {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  margin-top: 0.75rem;
}

.dialog-cancel-btn {
  flex: 1;
  padding: 0.65rem 1rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-spring);
}

.dialog-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.30);
}

.dialog-confirm-danger-btn {
  flex: 1;
  padding: 0.65rem 1rem;
  border-radius: 14px;
  background: rgba(248, 113, 113, 0.22);
  border: 1px solid rgba(248, 113, 113, 0.50);
  color: #FECACA;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(248, 113, 113, 0.25);
  transition: var(--transition-spring);
}

.dialog-confirm-danger-btn:hover {
  background: rgba(248, 113, 113, 0.35);
  border-color: rgba(248, 113, 113, 0.75);
  color: #FFFFFF;
  transform: translateY(-0.5px);
}
</style>
