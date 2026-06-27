import { useEffect, useState, useCallback } from 'react';
import { getCreditState, type CreditState } from '@/lib/credits/ledger';

export function useCreditBalance() {
  const [state, setState] = useState<CreditState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getCreditState();
      setState(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh on focus so the pill stays accurate after running workflows.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { state, loading, refresh };
}
