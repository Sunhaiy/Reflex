import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
