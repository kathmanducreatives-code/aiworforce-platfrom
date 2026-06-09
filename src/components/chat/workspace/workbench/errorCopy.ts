// Presentation-only mapping of raw tool/runtime error codes to friendly UX copy.
export interface FriendlyError {
  title: string;
  body: string;
  errorType: string;
  recovery: Array<'retry' | 'reconnect' | 'switch_source' | 'ask_alternative'>;
  reconnectProvider?: 'apify' | 'firecrawl' | 'resend' | 'google' | 'openai';
}

const MAP: Record<string, FriendlyError> = {
  apify_unauthorized: {
    title: 'Apify connection needs attention',
    body: 'Agentory could not access the selected Apify actor because the request was not authorized. Reconnect Apify or switch to another sourcing method.',
    errorType: 'Authorization failed',
    recovery: ['retry', 'reconnect', 'switch_source', 'ask_alternative'],
    reconnectProvider: 'apify',
  },
  apify_actor_disabled_by_default: {
    title: 'This Apify actor is disabled',
    body: 'The actor for this workflow is turned off by default. Enable it in settings or pick an alternative sourcing method.',
    errorType: 'Actor disabled',
    recovery: ['reconnect', 'switch_source', 'ask_alternative'],
    reconnectProvider: 'apify',
  },
  actor_missing: {
    title: 'No actor configured for this workflow',
    body: 'Agentory could not find an actor configured for this type of search. Pick an alternative sourcing method or configure the actor.',
    errorType: 'Actor missing',
    recovery: ['switch_source', 'ask_alternative'],
  },
  actor_key_unknown: {
    title: 'Unknown actor for this workflow',
    body: 'The selected actor key is not recognized. Pick an alternative sourcing method or reach out to support.',
    errorType: 'Unknown actor',
    recovery: ['switch_source', 'ask_alternative'],
  },
  firecrawl_unauthorized: {
    title: 'Firecrawl connection needs attention',
    body: 'Agentory could not access Firecrawl. Reconnect the integration to continue research.',
    errorType: 'Authorization failed',
    recovery: ['retry', 'reconnect', 'ask_alternative'],
    reconnectProvider: 'firecrawl',
  },
  rate_limited: {
    title: 'Rate limit hit',
    body: 'The provider temporarily blocked the request. Wait a moment and retry, or ask Pilot for an alternative path.',
    errorType: 'Rate limited',
    recovery: ['retry', 'ask_alternative'],
  },
  timeout: {
    title: 'Tool timed out',
    body: 'The run exceeded the allowed time. Retry, or ask Pilot to try a narrower request.',
    errorType: 'Timeout',
    recovery: ['retry', 'ask_alternative'],
  },
};

export function friendlyError(code: string | null | undefined, fallbackTool?: string): FriendlyError {
  const key = (code ?? '').toLowerCase().trim();
  if (key && MAP[key]) return MAP[key];

  // Heuristic match
  if (key.includes('unauthorized') || key.includes('forbidden') || key.includes('401') || key.includes('403')) {
    return {
      title: `${fallbackTool ?? 'Tool'} connection needs attention`,
      body: 'The request was not authorized. Reconnect the integration or switch sourcing method.',
      errorType: 'Authorization failed',
      recovery: ['retry', 'reconnect', 'switch_source', 'ask_alternative'],
    };
  }
  if (key.includes('timeout')) {
    return MAP.timeout;
  }
  if (key.includes('rate') || key.includes('429')) {
    return MAP.rate_limited;
  }

  return {
    title: 'This step did not complete',
    body: code
      ? 'The tool returned an error. Retry the run or ask Pilot for an alternative approach.'
      : 'Agentory could not finish this step. Retry or ask Pilot for an alternative approach.',
    errorType: 'Tool error',
    recovery: ['retry', 'ask_alternative'],
  };
}
