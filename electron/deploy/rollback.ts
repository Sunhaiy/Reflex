import { DeployStep } from '../../src/shared/deployTypes.js';

export class RollbackRunner {
  async run(
    steps: DeployStep[],
    execStep: (step: DeployStep) => Promise<void>,
  ): Promise<void> {
    for (const step of steps) {
      await execStep(step);
    }
  }
}
