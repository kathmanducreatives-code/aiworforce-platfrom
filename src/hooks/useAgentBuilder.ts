import { useEffect, useState } from 'react';
import type { AgentDept } from '@/data/agentProfiles';

export interface BuilderPrefill {
  department?: AgentDept;
}

type Listener = (state: { open: boolean; prefill: BuilderPrefill }) => void;

let _open = false;
let _prefill: BuilderPrefill = {};
const _listeners = new Set<Listener>();

function emit() {
  _listeners.forEach((l) => l({ open: _open, prefill: _prefill }));
}

export function openAgentBuilder(prefill: BuilderPrefill = {}) {
  _prefill = prefill;
  _open = true;
  emit();
}

export function closeAgentBuilder() {
  _open = false;
  _prefill = {};
  emit();
}

export function useAgentBuilder() {
  const [state, setState] = useState({ open: _open, prefill: _prefill });

  useEffect(() => {
    const listener: Listener = (s) => setState({ ...s });
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  return {
    open: state.open,
    prefill: state.prefill,
    openBuilder: openAgentBuilder,
    closeBuilder: closeAgentBuilder,
  };
}
