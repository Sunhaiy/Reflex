import type { AgentMode, ReasoningEffort } from '../../shared/agent';

/** Shared by the panel's segmented control and the settings page's radio list. */
export const AGENT_MODES: AgentMode[] = ['readonly', 'ask', 'auto', 'free'];

export const MODE_LABEL: Record<AgentMode, string> = {
  readonly: 'agent.modeReadonly',
  ask: 'agent.modeAsk',
  auto: 'agent.modeAuto',
  free: 'agent.modeFree',
};

export const MODE_HINT: Record<AgentMode, string> = {
  readonly: 'agent.modeReadonlyHint',
  ask: 'agent.modeAskHint',
  auto: 'agent.modeAutoHint',
  free: 'agent.modeFreeHint',
};

export const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  auto: 'agent.effortAuto',
  low: 'agent.effortLow',
  medium: 'agent.effortMedium',
  high: 'agent.effortHigh',
  xhigh: 'agent.effortXhigh',
};
