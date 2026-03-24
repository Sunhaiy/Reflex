export function renderStaticNginxConfig(params: {
  serverName: string;
  root: string;
}): string {
  return `server {
    listen 80;
    server_name ${params.serverName};

    root ${params.root};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}`;
}

export function renderProxyNginxConfig(params: {
  serverName: string;
  targetPort: number;
}): string {
  return `server {
    listen 80;
    server_name ${params.serverName};

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:${params.targetPort};
    }
}`;
}

