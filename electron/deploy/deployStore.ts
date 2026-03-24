import Store from 'electron-store';
import { DeployProfile, DeployRun } from '../../src/shared/deployTypes.js';

export class DeployStore {
  constructor(private store: Store) {}

  listProfiles(): DeployProfile[] {
    return (this.store.get('deployProfiles') as DeployProfile[] | undefined) || [];
  }

  findProfile(serverProfileId: string, projectRoot: string): DeployProfile | null {
    return (
      this.listProfiles().find(
        (profile) =>
          profile.serverProfileId === serverProfileId && profile.projectRoot === projectRoot,
      ) || null
    );
  }

  saveProfile(profile: DeployProfile): void {
    const current = this.listProfiles().filter((item) => item.id !== profile.id);
    this.store.set('deployProfiles', [...current, profile]);
  }

  listRuns(serverProfileId?: string): DeployRun[] {
    const runs = (((this.store.get('deployRuns') as DeployRun[] | undefined) || []) as DeployRun[]).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    return serverProfileId ? runs.filter((run) => run.serverProfileId === serverProfileId) : runs;
  }

  saveRun(run: DeployRun): void {
    const current = this.listRuns().filter((item) => item.id !== run.id);
    this.store.set('deployRuns', [run, ...current].slice(0, 40));
  }

  getRun(runId: string): DeployRun | null {
    return this.listRuns().find((run) => run.id === runId) || null;
  }
}
