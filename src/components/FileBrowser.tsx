// FileBrowser — orchestration layer
// All state lives in useFileBrowser; this file only handles layout and dialog state.
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { useState, useCallback, useRef, useEffect } from 'react';
import { FileEntry } from '../shared/types';
import { useFileBrowser } from './files/hooks/useFileBrowser';
import { FileToolbar } from './files/FileToolbar';
import { FileList } from './files/FileList';
import { FileContextMenu } from './files/FileContextMenu';
import { TransferPanel } from './files/TransferPanel';
import { ToastNotification } from './files/ToastNotification';
import { InputDialog } from './files/InputDialog';
import { FilePreview } from './files/FilePreview';
import { FileEditor } from './FileEditor';

interface Props {
  connectionId: string;
  isConnected?: boolean;
}

type DialogKind = 'newFolder' | 'newFile' | 'rename';
interface DialogState {
  kind: DialogKind;
  title: string;
  placeholder: string;
  defaultValue: string;
  entry?: FileEntry; // for rename
}

type SortField = 'name' | 'size' | 'date';
type SortOrder = 'asc' | 'desc';

interface ContextMenuState { x: number; y: number; file: FileEntry | null }

export function FileBrowser({ connectionId, isConnected = true }: Props) {
  const fb = useFileBrowser(connectionId);

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected) return;
    fb.loadFiles('/', true);
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [connectionId, isConnected]);

  useEffect(() => {
    setSelectedFile(null);
  }, [fb.currentPath]);

  // ── Compact mode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setIsCompact(e.contentRect.width < 480));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Sort ─────────────────────────────────────────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  // ── Context menu helpers ──────────────────────────────────────────────────────
  const openContextMenu = useCallback((e: React.MouseEvent, file: FileEntry | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFile(file);
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  }, []);

  // ── Dialog helpers ────────────────────────────────────────────────────────────
  const openNewFolder = () => setDialog({ kind: 'newFolder', title: '新建文件夹', placeholder: '文件夹名称', defaultValue: '' });
  const openNewFile = () => setDialog({ kind: 'newFile', title: '新建文件', placeholder: '文件名称', defaultValue: '' });
  const openRename = (file: FileEntry) => setDialog({ kind: 'rename', title: '重命名', placeholder: '新名称', defaultValue: file.name, entry: file });

  const handleDialogConfirm = async (value: string) => {
    if (!dialog) return;
    setDialog(null);
    if (dialog.kind === 'newFolder') await fb.createFolder(value);
    else if (dialog.kind === 'newFile') await fb.createFile(value);
    else if (dialog.kind === 'rename' && dialog.entry) await fb.renameEntry(dialog.entry, value);
  };

  // ── Delete confirm ────────────────────────────────────────────────────────────
  const requestDelete = (file: FileEntry) => setDeleteTarget(file);

  // ── Drag & drop ──────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    await fb.uploadDroppedFiles(Array.from(e.dataTransfer.files));
  };

  // ── File click ────────────────────────────────────────────────────────────────
  const handleSingleClick = (file: FileEntry) => setSelectedFile(file);
  const openEntry = async (file: FileEntry) => {
    setSelectedFile(file);
    if (file.type === 'd') {
      await fb.navigateInto(file);
      return;
    }
    setIsEditingFile(false);
    await fb.openFileEntry(file);
  };
  const handleDoubleClick = (file: FileEntry) => { void openEntry(file); };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-w-0 select-none flex-col overflow-hidden bg-transparent text-foreground"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-1.5 z-50 flex items-center justify-center rounded-xl border border-dashed border-foreground/30 bg-background/75 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-foreground/[0.055] px-6 py-5 shadow-xl">
            <HugeiconsIcon icon={Upload01Icon} className="h-7 w-7 animate-bounce text-foreground" />
            <span className="text-sm font-medium text-foreground">松开以上传文件</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <FileToolbar
        currentPath={fb.currentPath}
        loading={fb.loading}
        isCompact={isCompact}
        selectedFile={selectedFile}
        fileCount={fb.files.length}
        filterQuery={filterQuery}
        onFilterChange={setFilterQuery}
        onUp={fb.navigateUp}
        onHome={() => fb.navigateTo('/')}
        onRefresh={fb.refresh}
        onUpload={(file) => fb.uploadFile(file)}
        onNavigate={fb.navigateTo}
        onNewFolder={openNewFolder}
        onNewFile={openNewFile}
        onOpenSelected={() => { if (selectedFile) void openEntry(selectedFile); }}
        onDownloadSelected={() => { if (selectedFile && selectedFile.type !== 'd') void fb.downloadEntry(selectedFile); }}
        onRenameSelected={() => { if (selectedFile) openRename(selectedFile); }}
        onDeleteSelected={() => { if (selectedFile) requestDelete(selectedFile); }}
      />

      {/* File list */}
      <div className="flex-1 min-w-0 overflow-hidden" onContextMenu={e => openContextMenu(e)}>
        <FileList
          files={fb.files}
          loading={fb.loading}
          hasLoaded={fb.hasLoaded}
          isCompact={isCompact}
          sortField={sortField}
          sortOrder={sortOrder}
          filterQuery={filterQuery}
          selectedName={selectedFile?.name ?? null}
          onToggleSort={toggleSort}
          onFileClick={handleSingleClick}
          onFileDoubleClick={handleDoubleClick}
          onContextMenu={openContextMenu}
        />
      </div>

      {/* Transfer panel */}
      <TransferPanel transfers={fb.transfers} onClearHistory={fb.clearTransferHistory} />

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          onClose={() => setContextMenu(null)}
          onDownload={file => { setContextMenu(null); fb.downloadEntry(file); }}
          onOpen={file => { setContextMenu(null); void openEntry(file); }}
          onRename={file => { setContextMenu(null); openRename(file); }}
          onDelete={file => { setContextMenu(null); requestDelete(file); }}
          onNewFolder={() => { setContextMenu(null); openNewFolder(); }}
          onNewFile={() => { setContextMenu(null); openNewFile(); }}
          onRefresh={() => { setContextMenu(null); fb.refresh(); }}
        />
      )}

      {/* Input dialog */}
      {dialog && (
        <InputDialog
          title={dialog.title}
          placeholder={dialog.placeholder}
          defaultValue={dialog.defaultValue}
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-72 rounded-2xl border border-border/70 bg-card p-5 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-sm font-semibold mb-2">删除确认</h3>
            <p className="text-xs text-muted-foreground mb-5">
              确定要删除 <span className="font-mono text-foreground">{deleteTarget.name}</span> 吗？此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => { const t = deleteTarget; setDeleteTarget(null); setSelectedFile(null); await fb.deleteEntry(t); }}
                className="px-3 py-1.5 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <ToastNotification toasts={fb.toasts} onDismiss={fb.dismissToast} />

      {/* File-open loading overlay */}
      {fb.openingFile && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-background/50 backdrop-blur-[2px] pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card px-6 py-5 shadow-xl">
            <HugeiconsIcon icon={Loading02Icon} className="h-7 w-7 animate-spin text-foreground" />
            <span className="text-sm text-muted-foreground">正在加载文件...</span>
          </div>
        </div>
      )}

      {/* Unified read-only preview */}
      {fb.openFile && !isEditingFile && (
        <FilePreview
          file={fb.openFile}
          onClose={() => { setIsEditingFile(false); fb.closeFile(); }}
          onEdit={() => setIsEditingFile(true)}
          onDownload={() => void fb.downloadEntry(fb.openFile!.entry)}
        />
      )}

      {/* Text editor overlay */}
      {fb.openFile?.kind === 'text' && isEditingFile && (
        <FileEditor
          fileName={fb.openFile.name}
          filePath={fb.openFile.path}
          initialContent={fb.openFile.content}
          onSave={async (content) => {
            await fb.saveFile(fb.openFile!.path, content);
          }}
          onClose={() => { setIsEditingFile(false); fb.closeFile(); }}
        />
      )}
    </div>
  );
}
