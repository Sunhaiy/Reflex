import { useEffect, useState } from 'react';
import { FileEntry } from '@shared/types';
import { Folder, File, Upload, Download, ArrowUp, RefreshCw, Trash2, Edit2, MoreVertical } from 'lucide-react';

interface FileBrowserProps {
  connectionId: string;
}

interface ContextMenu {
  x: number;
  y: number;
  file: FileEntry;
}

export function FileBrowser({ connectionId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>(''); // Start empty, fetch PWD on mount
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renameState, setRenameState] = useState<{ file: FileEntry; newName: string } | null>(null);

  const loadFiles = async (path: string) => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const list = await window.electron.sftpList(connectionId, path);
      setFiles(list);
      setCurrentPath(path);
    } catch (err: any) {
      console.error('Error listing files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connectionId) {
      // Fetch initial PWD
      window.electron.getPwd(connectionId).then((pwd: string) => {
          loadFiles(pwd || '.');
      }).catch(() => {
          loadFiles('.');
      });
    } else {
      setFiles([]);
      setCurrentPath('');
    }
    
    // Close context menu on click elsewhere
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [connectionId]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'd') {
      // Use forward slash for SFTP paths
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadFiles(newPath);
    }
  };

  const handleUp = () => {
    if (!currentPath || currentPath === '/') return;
    
    // Use substring to find parent directory
    const lastSlashIndex = currentPath.lastIndexOf('/');
    if (lastSlashIndex === -1) return; // Should not happen for absolute paths
    
    const newPath = lastSlashIndex === 0 ? '/' : currentPath.substring(0, lastSlashIndex);
    loadFiles(newPath);
  };

  const handleCreateFolder = async () => {
      const name = prompt('Enter folder name:');
      if (!name) return;
      
      setLoading(true);
      try {
          const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electron.sftpMkdir(connectionId, newPath);
          loadFiles(currentPath);
      } catch (err: any) {
          alert('Create folder failed: ' + err.message);
      } finally {
          setLoading(false);
      }
  };

  const handleUpload = async () => {
    const localPath = await window.electron.openDialog();
    if (localPath) {
      setLoading(true);
      setProgress('Uploading...');
      try {
        const fileName = localPath.replace(/\\/g, '/').split('/').pop();
        const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
        
        await window.electron.sftpUpload(connectionId, localPath, remotePath || 'uploaded_file');
        loadFiles(currentPath);
        setProgress(null);
      } catch (err: any) {
        alert('Upload failed: ' + err.message);
        setProgress(null);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async (entry: FileEntry) => {
    const localPath = await window.electron.saveDialog(entry.name);
    if (localPath) {
      setLoading(true);
      setProgress(`Downloading ${entry.name}...`);
      try {
        const remotePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
        await window.electron.sftpDownload(connectionId, remotePath, localPath);
        setProgress(null);
      } catch (err: any) {
        alert('Download failed: ' + err.message);
        setProgress(null);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRenameClick = (file: FileEntry) => {
      setRenameState({ file, newName: file.name });
      setContextMenu(null);
  };

  const submitRename = async () => {
      if (!renameState) return;
      const { file, newName } = renameState;
      if (!newName || newName === file.name) {
          setRenameState(null);
          return;
      }

      setLoading(true);
      try {
          const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
          const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
          await window.electron.sftpRename(connectionId, oldPath, newPath);
          loadFiles(currentPath);
      } catch (err: any) {
          alert('Rename failed: ' + err.message);
      } finally {
          setLoading(false);
          setRenameState(null);
      }
  };

  const handleDelete = async (entry: FileEntry) => {
      if(!confirm(`Are you sure you want to delete ${entry.name}?`)) return;
      
      setLoading(true);
      try {
          const remotePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
          await window.electron.sftpDelete(connectionId, remotePath); 
          loadFiles(currentPath);
      } catch (err: any) {
          alert('Delete failed: ' + err.message);
      } finally {
          setLoading(false);
      }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
          x: e.clientX,
          y: e.clientY,
          file
      });
  };

  if (!connectionId) {
    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 shadow-sm items-center justify-center text-gray-400 text-sm">
            No connection
        </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 shadow-sm overflow-hidden relative">
      <div className="p-2 border-b dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center gap-2 flex-1 overflow-hidden">
          <button onClick={handleUp} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
            <ArrowUp className="w-4 h-4" />
          </button>
          <input 
            className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-gray-700 dark:text-gray-300 truncate"
            value={currentPath}
            readOnly
          />
        </div>
        <div className="flex items-center gap-1">
          <button 
             onClick={() => loadFiles(currentPath)}
             className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-700 dark:text-gray-300"
             title="Refresh"
          >
             <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleCreateFolder} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-700 dark:text-gray-300" title="New Folder">
             <Folder className="w-4 h-4" />
          </button>
          <button onClick={handleUpload} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-blue-600 dark:text-blue-400" title="Upload File">
            <Upload className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {progress && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 animate-pulse">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {progress}
          </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-950 sticky top-0 text-gray-700 dark:text-gray-300">
            <tr>
              <th className="p-2 font-medium">Name</th>
              <th className="p-2 font-medium w-20">Size</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-800 text-gray-700 dark:text-gray-300">
            {files.map((file, i) => (
              <tr 
                key={i} 
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <td className="p-2">
                  <button 
                    onClick={() => handleNavigate(file)}
                    className="flex items-center gap-2 hover:underline text-inherit text-left w-full truncate"
                  >
                    {file.type === 'd' ? <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" /> : <File className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                    <span className="truncate">{file.name}</span>
                  </button>
                </td>
                <td className="p-2 text-gray-500 text-xs">
                  {file.type === '-' ? (file.size / 1024).toFixed(1) + ' KB' : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <div 
            className="fixed bg-white dark:bg-gray-800 border dark:border-gray-700 shadow-lg rounded-md py-1 z-50 min-w-[120px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
        >
            <div className="px-3 py-1 text-xs text-gray-500 border-b dark:border-gray-700 mb-1 truncate max-w-[150px]">
                {contextMenu.file.name}
            </div>
            {contextMenu.file.type === '-' && (
                <button 
                    onClick={() => handleDownload(contextMenu.file)}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
                >
                    <Download className="w-3 h-3" /> Download
                </button>
            )}
            <button 
                onClick={() => handleRenameClick(contextMenu.file)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
            >
                <Edit2 className="w-3 h-3" /> Rename
            </button>
            <button 
                onClick={() => handleDelete(contextMenu.file)}
                className="w-full text-left px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center gap-2 text-sm"
            >
                <Trash2 className="w-3 h-3" /> Delete
            </button>
        </div>
      )}

      {renameState && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl p-4 w-full max-w-sm border dark:border-gray-800">
                <h3 className="font-bold mb-4">Rename File</h3>
                <input 
                    className="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white mb-4"
                    value={renameState.newName}
                    onChange={e => setRenameState({ ...renameState, newName: e.target.value })}
                    autoFocus
                    onKeyDown={e => {
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setRenameState(null);
                    }}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={() => setRenameState(null)}
                        className="px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={submitRename}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Rename
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
