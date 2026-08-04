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

/**
 * Tier names, not translations.
 *
 * The value on the wire is fixed by the providers — `low` through `max` and nothing else,
 * since anything they do not recognise is a 400 — so the ladder is named rather than
 * described, and reads the same in every language.
 */
export const EFFORT_NAME: Record<ReasoningEffort, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Ultra',
  max: 'Max',
};
