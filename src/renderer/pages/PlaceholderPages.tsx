
export function ConnectionManager() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Connection Manager</h2>
      <p>Manage your SSH connections here.</p>
      {/* List of connections will go here */}
    </div>
  );
}

export function TerminalPage() {
  return (
    <div className="p-4 h-full flex flex-col">
      <h2 className="text-2xl font-bold mb-4">Terminal</h2>
      <div className="flex-1 bg-black rounded-lg p-4 text-green-400 font-mono">
        $ echo "Terminal not connected"
      </div>
    </div>
  );
}

export function SFTPPage() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">File Transfer (SFTP)</h2>
      <p>Upload and download files.</p>
    </div>
  );
}

export function ResourceMonitor() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">System Resources</h2>
      <p>CPU and Memory usage monitoring.</p>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Settings</h2>
      <p>Theme and Language settings.</p>
    </div>
  );
}
