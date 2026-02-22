import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileEntry } from '../shared/types';
import {
  Folder, File, ArrowLeft, RefreshCw, Upload, Download, Trash2, Edit2,
  Plus, ArrowUp, FolderPlus, Star, Bookmark, X, Search, ChevronDown, ChevronUp
} from 'lucide-react';
import { FileEditor } from './FileEditor';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { useSettingsStore } from '../store/settingsStore';

// Add global declaration for electron
declare global {
  interface Window {
    electron: any;
  }
}

interface FileBrowserProps {
  connectionId: string;
}

interface ContextMenu {
  x: number;
  y: number;
  file: FileEntry | null;
}

type SortField = 'name' | 'size' | 'date';
type SortOrder = 'asc' | 'desc';

export function FileBrowser({ connectionId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [editingFile, setEditingFile] = useState<{ name: string, path: string, content: string } | null>(null);
  const [pathCache, setPathCache] = useState<Record<string, FileEntry[]>>({});
  const [inputPath, setInputPath] = useState('/');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ file: string, percent: number } | null>(null);
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    message: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  } | null>(null);

  // Sorting State
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Filter State
  const [filterQuery, setFilterQuery] = useState('');

  // Bookmarks State
  const [showBookmarks, setShowBookmarks] = useState(false);

  // Use Settings Store for bookmarks
  const { bookmarks, toggleBookmark } = useSettingsStore();

  // Responsive State using ResizeObserver
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarkBtnRef = useRef<HTMLButtonElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Toggle compact mode if width is less than 500px (adjust threshold as needed)
        setIsCompact(entry.contentRect.width < 500);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const loadFiles = async (path: string, force = false) => {
    if (!force && pathCache[path]) {
      setFiles(pathCache[path]);
      setCurrentPath(path);
      setInputPath(path);
      return;
    }

    setLoading(true);
    try {
      if (path === '.') {
        const pwd = await window.electron.getPwd(connectionId);
        path = pwd;
        if (!force && pathCache[path]) {
          setFiles(pathCache[path]);
          setCurrentPath(path);
          setInputPath(path);
          setLoading(false);
          return;
        }
      }

      const list = await window.electron.sftpList(connectionId, path);
      const newFiles = Array.isArray(list) ? list : [];
      setFiles(newFiles);
      setPathCache(prev => ({ ...prev, [path]: newFiles }));
      setCurrentPath(path);
      setInputPath(path);
    } catch (err) {
      console.error(err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileOpen = async (file: FileEntry, path: string) => {
    setLoading(true);
    try {
      const content = await window.electron.sftpReadFile(connectionId, path);
      setEditingFile({
        name: file.name,
        path: path,
        content: content
      });
    } catch (err) {
      alert('无法打开文件: ' + err);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      const filePath = (file as any).path;
      if (!filePath) continue;

      setUploadProgress({ file: file.name, percent: 0 });
      try {
        await window.electron.sftpUpload(connectionId, filePath, currentPath + '/' + file.name);
      } catch (err: any) {
        alert(`上传失败 ${file.name}: ${err.message}`);
      }
    }
    setUploadProgress(null);
    loadFiles(currentPath, true);
  };

  useEffect(() => {
    setPathCache({});
    loadFiles('/', true);

    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [connectionId]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'd') {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadFiles(newPath);
    }
  };

  const handleUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length === 1 ? '/' : parts.join('/') || '/';
    loadFiles(newPath);
  };

  const handleUpload = async () => {
    const localPath = await window.electron.openDialog();
    if (localPath) {
      setLoading(true);
      try {
        const filename = localPath.split(/[\\/]/).pop();
        const remotePath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`;
        await window.electron.sftpUpload(connectionId, localPath, remotePath);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('上传失败: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleCreateFolder = async () => {
    setContextMenu(null);
    setInputDialog({
      title: '新建文件夹',
      message: '请输入文件夹名称:',
      defaultValue: '',
      onConfirm: async (name) => {
        setLoading(true);
        try {
          const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electron.sftpMkdir(connectionId, newPath);
          await loadFiles(currentPath, true);
        } catch (e) {
          alert('创建文件夹失败: ' + e);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCreateFile = async () => {
    setContextMenu(null);
    setInputDialog({
      title: '新建文件',
      message: '请输入文件名称:',
      defaultValue: '',
      onConfirm: async (name) => {
        setLoading(true);
        try {
          const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electron.sftpWriteFile(connectionId, newPath, '');
          await loadFiles(currentPath, true);
        } catch (e) {
          alert('创建文件失败: ' + e);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleDelete = async (file: FileEntry) => {
    if (confirm(`确定要删除 ${file.name} 吗?`)) {
      setLoading(true);
      try {
        const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await window.electron.sftpDelete(connectionId, path);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('删除失败: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async (file: FileEntry) => {
    const localPath = await window.electron.saveDialog(file.name);
    if (localPath) {
      setLoading(true);
      try {
        const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await window.electron.sftpDownload(connectionId, remotePath, localPath);
        alert('下载完成');
      } catch (e) {
        alert('下载失败: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRename = async (file: FileEntry) => {
    setContextMenu(null);
    setInputDialog({
      title: '重命名',
      message: `请输入 ${file.name} 的新名称:`,
      defaultValue: file.name,
      onConfirm: async (newName) => {
        if (newName && newName !== file.name) {
          setLoading(true);
          try {
            const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
            await window.electron.sftpRename(connectionId, oldPath, newPath);
            await loadFiles(currentPath, true);
          } catch (e) {
            alert('重命名失败: ' + e);
          } finally {
            setLoading(false);
          }
        }
      }
    });
  };

  const onContextMenu = (e: React.MouseEvent, file: FileEntry | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  // Sorting and Filtering Logic
  const sortedAndFilteredFiles = useMemo(() => {
    let result = files;

    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(q));
    }

    return result.sort((a, b) => {
      // Always put directories first
      if (a.type !== b.type) {
        return a.type === 'd' ? -1 : 1;
      }

      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [files, sortField, sortOrder, filterQuery]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <div className="w-3 h-3 opacity-0" />;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  // Breadcrumb Component
  const Breadcrumbs = () => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(inputPath);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    useEffect(() => {
      setEditValue(currentPath);
    }, [currentPath]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        loadFiles(editValue);
        setIsEditing(false);
      } else if (e.key === 'Escape') {
        setIsEditing(false);
        setEditValue(currentPath);
      }
    };

    if (isEditing) {
      return (
        <div className="flex-1 h-7 bg-muted/30 border border-primary/30 rounded flex items-center px-2">
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-xs font-mono"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setIsEditing(false)}
          />
        </div>
      );
    }

    const segments = currentPath.split('/').filter(Boolean);
    const breadcrumbItems = [
      { name: '/', path: '/' },
      ...segments.map((segment, index) => ({
        name: segment,
        path: '/' + segments.slice(0, index + 1).join('/')
      }))
    ];

    return (
      <div
        className="flex-1 flex items-center gap-0.5 overflow-hidden h-7 px-1 rounded hover:bg-muted/30 cursor-text transition-colors"
        onClick={() => setIsEditing(true)}
      >
        <div className="flex items-center text-xs text-muted-foreground whitespace-nowrap overflow-x-auto no-scrollbar mask-gradient-right">
          {breadcrumbItems.map((item, index) => (
            <div key={item.path} className="flex items-center">
              {index > 0 && <span className="mx-0.5 opacity-50">/</span>}
              <span
                className="hover:text-foreground hover:bg-muted/50 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  loadFiles(item.path);
                }}
              >
                {item.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-transparent text-foreground relative select-none overflow-hidden min-w-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/20 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none backdrop-blur-[1px]">
          <div className="bg-background/80 p-4 rounded-lg shadow-lg flex flex-col items-center animate-bounce">
            <Upload className="w-8 h-8 text-primary mb-2" />
            <span className="font-bold text-primary">拖放文件上传</span>
          </div>
        </div>
      )}

      {uploadProgress && (
        <div className="absolute bottom-4 right-4 z-50 bg-card border border-border shadow-lg p-3 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
          <RefreshCw className="w-4 h-4 text-primary animate-spin" />
          <div className="text-sm">
            <div className="font-medium">正在上传...</div>
            <div className="text-xs text-muted-foreground">{uploadProgress.file}</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="border-b border-border flex flex-col bg-transparent">
        {/* Row 1: Navigation + Actions */}
        <div className="h-9 flex items-center gap-1.5 px-2">
          <button onClick={handleUp} className="p-1.5 hover:bg-accent hover:text-accent-foreground rounded-md text-muted-foreground transition-colors focus:outline-none" title="向上一级">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => loadFiles(currentPath, true)} className="p-1.5 hover:bg-accent hover:text-accent-foreground rounded-md text-muted-foreground transition-colors focus:outline-none" title="刷新">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => loadFiles('/')} className="p-1.5 hover:bg-accent hover:text-accent-foreground rounded-md text-muted-foreground transition-colors focus:outline-none" title="回到根目录">
            <div className="w-3.5 h-3.5 flex items-center justify-center font-bold text-[10px]">~</div>
          </button>
          <div className="w-px h-4 bg-border mx-0.5"></div>
          <button
            onClick={() => toggleBookmark(currentPath)}
            className={cn("p-1.5 rounded-md transition-colors focus:outline-none", bookmarks.includes(currentPath) ? 'text-yellow-500 hover:bg-yellow-500/10' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}
            title="添加到书签"
          >
            <Star className={cn("w-3.5 h-3.5", bookmarks.includes(currentPath) && "fill-current")} />
          </button>
          <div className="relative">
            <button
              ref={bookmarkBtnRef}
              className={cn("p-1.5 rounded-md transition-colors focus:outline-none", showBookmarks ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}
              title="书签"
              onClick={() => setShowBookmarks(!showBookmarks)}
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
            {showBookmarks && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBookmarks(false)} />
                {createPortal(
                  <div
                    className="fixed w-56 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 animate-in fade-in zoom-in-95"
                    style={(() => {
                      const rect = bookmarkBtnRef.current?.getBoundingClientRect();
                      if (!rect) return { top: 40, left: 10 };
                      return { top: rect.bottom + 4, left: Math.max(4, rect.right - 224) };
                    })()}
                  >
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border mb-1">
                      收藏夹
                    </div>
                    {bookmarks.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground italic">暂无书签</div>
                    ) : (
                      bookmarks.map(path => (
                        <div
                          key={path}
                          className="px-3 py-2 hover:bg-accent hover:text-accent-foreground cursor-pointer text-xs flex justify-between items-center group/item mx-1 rounded-md transition-colors"
                          onClick={() => {
                            loadFiles(path);
                            setShowBookmarks(false);
                          }}
                        >
                          <div className="flex items-center gap-2 truncate flex-1">
                            <Folder className="w-3.5 h-3.5 text-blue-400 fill-blue-400/20" />
                            <span className="truncate" title={path}>{path}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleBookmark(path); }}
                            className="text-muted-foreground hover:text-destructive opacity-0 group-hover/item:opacity-100 transition-opacity p-0.5 rounded focus:outline-none"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>,
                  document.body
                )}
              </>
            )}
          </div>
        </div>
        {/* Row 2: Breadcrumb Path */}
        <div className="h-8 flex items-center px-2 border-t border-border/30">
          <Breadcrumbs />
        </div>
      </div>

      {/* File List Header */}
      <div className="flex items-center px-3 py-1.5 border-b border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/10">
        <div className="w-6 flex justify-center shrink-0">#</div>
        <div
          className="flex-1 min-w-0 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors pl-1"
          onClick={() => toggleSort('name')}
        >
          名称 <SortIcon field="name" />
        </div>
        {!isCompact && (
          <div
            className="w-28 shrink-0 flex items-center gap-1 cursor-pointer hover:text-foreground justify-end transition-colors"
            onClick={() => toggleSort('date')}
          >
            日期 <SortIcon field="date" />
          </div>
        )}
        {!isCompact && (
          <div
            className="w-14 shrink-0 flex items-center gap-1 cursor-pointer hover:text-foreground justify-end transition-colors"
            onClick={() => toggleSort('size')}
          >
            大小 <SortIcon field="size" />
          </div>
        )}
      </div>

      {/* File List */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onContextMenu={(e) => onContextMenu(e)}
      >
        <div className="flex flex-col min-h-full pb-2">
          {sortedAndFilteredFiles.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">暂无文件</p>
            </div>
          ) : (
            sortedAndFilteredFiles.map((file, i) => (
              <div
                key={i}
                className="flex items-center px-3 py-1.5 cursor-pointer text-xs group transition-all border-b border-transparent hover:bg-accent/50 hover:border-border/30"
                onClick={() => file.type === 'd' ? handleNavigate(file) : null}
                onDoubleClick={() => {
                  if (file.type === '-') {
                    const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                    handleFileOpen(file, path);
                  }
                }}
                onContextMenu={(e) => onContextMenu(e, file)}
              >
                <div className="w-6 flex justify-center shrink-0">
                  {file.type === 'd' ? (
                    <Folder className="w-4 h-4 text-blue-400 fill-blue-400/20" />
                  ) : (
                    <File className="w-4 h-4 text-muted-foreground/60" />
                  )}
                </div>

                <div className="flex-1 min-w-0 flex items-center pl-1">
                  <span className="truncate text-foreground/90 font-medium group-hover:text-foreground">{file.name}</span>
                </div>

                {!isCompact && (
                  <div className="w-28 shrink-0 text-right text-muted-foreground/60 font-mono text-[10px] tabular-nums">
                    {file.date ? format(new Date(file.date), 'yyyy-MM-dd HH:mm') : '-'}
                  </div>
                )}

                {!isCompact && (
                  <div className="w-14 shrink-0 text-right text-muted-foreground/60 font-mono text-[10px] tabular-nums">
                    {file.type === 'd' ? '-' : formatSize(file.size)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          {createPortal(
            <div
              className="fixed z-50 w-48 bg-popover border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={() => setContextMenu(null)}
            >
              {/* ... (Existing Context Menu Content - kept simple for now, can be expanded) */}
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border/50 mb-1 mx-1">
                {contextMenu.file ? contextMenu.file.name : '当前目录'}
              </div>

              {contextMenu.file && (
                <>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors"
                    onClick={() => {
                      if (contextMenu.file) {
                        const path = currentPath === '/' ? `/${contextMenu.file.name}` : `${currentPath}/${contextMenu.file.name}`;
                        handleDownload(path);
                      }
                    }}
                  >
                    <Download className="w-3.5 h-3.5" /> 下载
                  </button>
                  {contextMenu.file.type === '-' && (
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors"
                      onClick={() => {
                        if (contextMenu.file) {
                          const path = currentPath === '/' ? `/${contextMenu.file.name}` : `${currentPath}/${contextMenu.file.name}`;
                          handleFileOpen(contextMenu.file, path);
                        }
                      }}
                    >
                      <Edit2 className="w-3.5 h-3.5" /> 编辑
                    </button>
                  )}
                  <div className="h-px bg-border/50 my-1 mx-2" />
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-destructive hover:text-destructive-foreground text-xs flex items-center gap-2 text-destructive transition-colors rounded-sm mx-1 w-[calc(100%-8px)]"
                    onClick={() => {
                      if (contextMenu.file) {
                        const path = currentPath === '/' ? `/${contextMenu.file.name}` : `${currentPath}/${contextMenu.file.name}`;
                        handleDelete(path);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 删除
                  </button>
                </>
              )}

              {!contextMenu.file && (
                <>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors"
                    onClick={() => {
                      setInputDialog({
                        title: '新建文件夹',
                        message: '请输入文件夹名称:',
                        defaultValue: '',
                        onConfirm: (value) => handleCreateFolder(value)
                      });
                    }}
                  >
                    <FolderPlus className="w-3.5 h-3.5" /> 新建文件夹
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors"
                    onClick={() => {
                      setInputDialog({
                        title: '新建文件',
                        message: '请输入文件名称:',
                        defaultValue: '',
                        onConfirm: (value) => handleCreateFile(value)
                      });
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> 新建文件
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground text-xs flex items-center gap-2 transition-colors"
                    onClick={() => loadFiles(currentPath, true)}
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> 刷新
                  </button>

                </>
              )}
            </div>,
            document.body
          )}
        </>
      )}

      {/* Input Dialog (Simple Re-implementation) */}
      {inputDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border p-6 rounded-lg shadow-xl w-80 animate-in zoom-in-95 scale-100">
            <h3 className="text-sm font-semibold mb-2">{inputDialog.title}</h3>
            <p className="text-xs text-muted-foreground mb-4">{inputDialog.message}</p>
            <input
              autoFocus
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs mb-4 outline-none focus:ring-1 focus:ring-primary"
              defaultValue={inputDialog.defaultValue}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  inputDialog.onConfirm((e.currentTarget as HTMLInputElement).value);
                  setInputDialog(null);
                } else if (e.key === 'Escape') {
                  setInputDialog(null);
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setInputDialog(null)}
                className="px-3 py-1.5 rounded text-xs hover:bg-secondary text-muted-foreground transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                }}
                className="hidden"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {editingFile && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-bottom-5">
          <div className="border-b border-border p-2 flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <button onClick={() => setEditingFile(null)} className="p-1 hover:bg-accent rounded text-muted-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium">{editingFile.name}</span>
            </div>
          </div>
          <FileEditor
            content={editingFile.content}
            path={editingFile.path}
            onSave={async (content) => {
              await window.electron.sftpWriteFile(connectionId, editingFile.path, content);
              loadFiles(currentPath); // Refresh
            }}
            onClose={() => setEditingFile(null)}
          />
        </div>
      )}
    </div>
  );
}
