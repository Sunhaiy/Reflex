/** Vocabulary the Docker panel's tabs share. */
export type DockerTabId = 'containers' | 'images' | 'prune';
export type ContainerFilter = 'all' | 'running' | 'stopped';

export interface DockerTabProps {
  connectionId: string;
}
