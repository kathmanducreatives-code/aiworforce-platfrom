// Presentation only. Never used to authorize or route a task. All options stay disabled.
export const TASK_MODEL_OPTIONS = Object.freeze([
  { provider: 'openai', model: 'gpt-4.1-mini', label: 'OpenAI · GPT-4.1 mini', enabled: false, reason: 'Proposed first adapter. Offline tests only; native accounting, credentials, consent and T01 integration acceptance pending.' },
  { provider: 'anthropic', model: null, label: 'Claude', enabled: false, reason: 'Pilot adapter and execution policy not verified.' },
  { provider: 'google', model: null, label: 'Gemini', enabled: false, reason: 'Pilot adapter and execution policy not verified.' },
] as const);
