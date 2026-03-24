export function renderSystemdService(params: {
  description: string;
  workingDirectory: string;
  user: string;
  environmentFile?: string;
  environment?: Record<string, string>;
  execStart: string;
}): string {
  const envLines = Object.entries(params.environment || {})
    .map(([key, value]) => `Environment="${key}=${value.replace(/"/g, '\\"')}"`)
    .join('\n');

  return `[Unit]
Description=${params.description}
After=network.target

[Service]
Type=simple
User=${params.user}
WorkingDirectory=${params.workingDirectory}
${params.environmentFile ? `EnvironmentFile=${params.environmentFile}` : ''}
${envLines}
ExecStart=${params.execStart}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

