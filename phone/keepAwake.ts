import { useEffect } from 'react';

// Wraps expo-keep-awake so the app still loads if the dev-client hasn't been
// rebuilt with the native module. Rebuild the APK to enable it.
export function useKeepAwakeSafe(): void {
  useEffect(() => {
    let mod: typeof import('expo-keep-awake') | null = null;
    try {
      mod = require('expo-keep-awake');
      mod!.activateKeepAwakeAsync();
    } catch (err) {
      console.warn('expo-keep-awake unavailable — rebuild dev-client to enable screen-on', err);
      return;
    }
    return () => {
      try {
        mod!.deactivateKeepAwake();
      } catch {}
    };
  }, []);
}
