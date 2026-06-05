import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';

// Clear the pre-React loading fallback once React takes over.
const removeBootFallback = () => {
  const el = document.getElementById('boot-fallback');
  if (el) el.remove();
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

// Run after first paint to avoid race with React mount.
requestAnimationFrame(() => requestAnimationFrame(removeBootFallback));
