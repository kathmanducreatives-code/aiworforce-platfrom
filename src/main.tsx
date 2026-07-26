import React from 'react';
import { createRoot } from 'react-dom/client';
import AppErrorBoundary from './components/AppErrorBoundary';
import EnvironmentConfigScreen from './components/dev/EnvironmentConfigScreen';
import { resolveEnvironmentGate } from './lib/env/environmentGate';
import './index.css';

// Clear the pre-React loading fallback once React takes over.
const removeBootFallback = () => {
  const el = document.getElementById('boot-fallback');
  if (el) el.remove();
};

const root = createRoot(document.getElementById("root")!);

// ENVIRONMENT GATE, BEFORE ANYTHING IMPORTS THE SUPABASE CLIENT.
//
// `client.ts` throws at module-evaluation time when local development has no
// explicit target, so a STATIC `import App from './App.tsx'` would crash the
// bundle before React could render anything — a blank page instead of an
// explanation. The gate is resolved first and App is imported dynamically only
// once it passes. Production builds always pass, so their behaviour is unchanged.
const gate = resolveEnvironmentGate({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  DEV: !!import.meta.env.DEV,
});

if (gate.status === 'blocked') {
  root.render(
    <React.StrictMode>
      <EnvironmentConfigScreen gate={gate} />
    </React.StrictMode>
  );
  requestAnimationFrame(() => requestAnimationFrame(removeBootFallback));
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>
    );
    // Run after first paint to avoid race with React mount.
    requestAnimationFrame(() => requestAnimationFrame(removeBootFallback));
  });
}
