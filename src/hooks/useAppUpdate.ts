import { useCallback, useEffect, useState } from 'react';
import type { AppUpdateState } from '../shared/update';

const initialState: AppUpdateState = {
  phase: 'idle',
  currentVersion: '',
  automatic: false,
};

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(initialState);

  useEffect(() => {
    const unsubscribe = window.electron.onUpdateState(setState);
    void window.electron.updateGetState().then(setState).catch(() => undefined);
    return unsubscribe;
  }, []);

  const check = useCallback(() => window.electron.updateCheck(), []);
  const apply = useCallback(() => window.electron.updateApply(), []);

  return { state, check, apply };
}
