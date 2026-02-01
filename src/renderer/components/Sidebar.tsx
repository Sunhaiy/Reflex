import { Link, useLocation } from 'react-router-dom';
import { Terminal, HardDrive, FolderInput, Settings, Server } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: Server, label: 'Connections', path: '/' },
  { icon: Terminal, label: 'Terminal', path: '/terminal' },
  { icon: FolderInput, label: 'SFTP', path: '/sftp' },
  { icon: HardDrive, label: 'Resources', path: '/resources' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-screen">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Terminal className="w-6 h-6 text-blue-400" />
          SSH Tool
        </h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname === item.path
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-gray-800 hover:text-white"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <div className="text-xs text-gray-500 text-center">v0.1.0</div>
      </div>
    </div>
  );
}
