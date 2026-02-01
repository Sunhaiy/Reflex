import { Minus, Square, X } from 'lucide-react';

export function TitleBar() {
  return (
    <div className="h-8 bg-gray-200 dark:bg-gray-800 flex justify-between items-center select-none" style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="px-4 text-xs font-semibold text-gray-600 dark:text-gray-400">
        SSH Tool
      </div>
      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button 
          onClick={() => window.electron.minimizeWindow()}
          className="h-full px-4 hover:bg-gray-300 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button 
          onClick={() => window.electron.maximizeWindow()}
          className="h-full px-4 hover:bg-gray-300 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400"
        >
          <Square className="w-3 h-3" />
        </button>
        <button 
          onClick={() => window.electron.closeWindow()}
          className="h-full px-4 hover:bg-red-500 hover:text-white flex items-center justify-center text-gray-600 dark:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
