import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/useConnectionStore';
import { FileEntry } from '@shared/types';
import { Folder, File, Upload, Download, ArrowUp, RefreshCw } from 'lucide-react';

export function SFTPPage() {
  const { connections, loadConnections } = useConnectionStore();
  const [selectedId, setSelectedId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('.');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadFiles = async (path: string) => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const list = await window.electron.sftpList(selectedId, path);
      setFiles(list);
      // We don't get the absolute path back from listFiles easily unless we ask for it (pwd)
      // For now, assume navigation works relative or we keep track.
      // But updating currentPath to 'path' works if path is valid.
      // If path is 'foo/..', we might want to normalize it visually, but for logic 'foo/..' is fine.
      setCurrentPath(path);
    } catch (err: any) {
      alert('Error listing files: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      loadFiles('.');
    } else {
      setFiles([]);
      setCurrentPath('.');
    }
  }, [selectedId]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'd') {
      const newPath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
      loadFiles(newPath);
    }
  };

  const handleUp = () => {
    if (currentPath === '.' || currentPath === '/') return;
    // Simple up navigation by appending '..'
    // In a real app we'd resolve path properly
    const newPath = currentPath === '.' ? '..' : `${currentPath}/..`;
    loadFiles(newPath);
  };

  const handleUpload = async () => {
    const localPath = await window.electron.openDialog();
    if (localPath) {
      setLoading(true);
      try {
        // Extract filename from local path
        // Windows uses backslash, Unix uses slash
        const fileName = localPath.replace(/\\/g, '/').split('/').pop();
        const remotePath = currentPath === '.' ? fileName : `${currentPath}/${fileName}`;
        
        await window.electron.sftpUpload(selectedId, localPath, remotePath || 'uploaded_file');
        loadFiles(currentPath);
        alert('Upload successful');
      } catch (err: any) {
        alert('Upload failed: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async (entry: FileEntry) => {
    const localPath = await window.electron.saveDialog(entry.name);
    if (localPath) {
      setLoading(true);
      try {
        const remotePath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
        await window.electron.sftpDownload(selectedId, remotePath, localPath);
        alert('Download successful');
      } catch (err: any) {
        alert('Download failed: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold tracking-tight">File Transfer</h2>
        <div className="flex gap-2">
           <select 
             className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 dark:text-white"
             value={selectedId}
             onChange={e => setSelectedId(e.target.value)}
           >
             <option value="">Select Connection</option>
             {connections.map(c => (
               <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
             ))}
           </select>
           <button 
             onClick={() => loadFiles(currentPath)}
             className="p-2 bg-gray-100 dark:bg-gray-800 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
             disabled={!selectedId}
           >
             <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
           </button>
        </div>
      </div>

      {selectedId ? (
        <div className="flex-1 bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-800 flex flex-col overflow-hidden shadow-sm">
           <div className="p-2 border-b dark:border-gray-800 flex items-center gap-2 bg-gray-50 dark:bg-gray-950">
              <button onClick={handleUp} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
                <ArrowUp className="w-4 h-4" />
              </button>
              <input 
                className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-gray-700 dark:text-gray-300"
                value={currentPath}
                readOnly
              />
              <button onClick={handleUpload} className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                <Upload className="w-4 h-4" /> Upload
              </button>
           </div>
           
           <div className="flex-1 overflow-auto">
             <table className="w-full text-left text-sm">
               <thead className="bg-gray-50 dark:bg-gray-950 sticky top-0 text-gray-700 dark:text-gray-300">
                 <tr>
                   <th className="p-3 font-medium">Name</th>
                   <th className="p-3 font-medium w-24">Size</th>
                   <th className="p-3 font-medium w-40">Date</th>
                   <th className="p-3 font-medium w-24">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                 {files.map((file, i) => (
                   <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                     <td className="p-3">
                       <button 
                         onClick={() => handleNavigate(file)}
                         className="flex items-center gap-2 hover:underline text-inherit"
                       >
                         {file.type === 'd' ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-gray-400" />}
                         {file.name}
                       </button>
                     </td>
                     <td className="p-3 text-gray-500">
                       {file.type === '-' ? (file.size / 1024).toFixed(1) + ' KB' : '-'}
                     </td>
                     <td className="p-3 text-gray-500">
                       {new Date(file.date).toLocaleDateString()}
                     </td>
                     <td className="p-3">
                       {file.type === '-' && (
                         <button onClick={() => handleDownload(file)} className="text-gray-500 hover:text-blue-500 transition-colors">
                           <Download className="w-4 h-4" />
                         </button>
                       )}
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500">
           Select a connection to manage files (Must be connected first)
        </div>
      )}
    </div>
  );
}
