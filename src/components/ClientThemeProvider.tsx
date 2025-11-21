import { useEffect } from 'react';
import { useClient } from '@/contexts/ClientContext';

export const ClientThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { client } = useClient();

  useEffect(() => {
    if (!client) return;

    // Helper to convert hex to HSL
    const hexToHSL = (hex: string): string => {
      // Remove # if present
      hex = hex.replace('#', '');
      
      // Convert to RGB
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0, s = 0, l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }

      h = Math.round(h * 360);
      s = Math.round(s * 100);
      l = Math.round(l * 100);

      return `${h} ${s}% ${l}%`;
    };

    // Apply client colors as CSS variables
    const root = document.documentElement;
    
    if (client.primary_color) {
      root.style.setProperty('--primary', hexToHSL(client.primary_color));
    }
    if (client.secondary_color) {
      root.style.setProperty('--secondary', hexToHSL(client.secondary_color));
    }
    if (client.accent_color) {
      root.style.setProperty('--accent', hexToHSL(client.accent_color));
    }

    // Cleanup function to reset on unmount
    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--secondary');
      root.style.removeProperty('--accent');
    };
  }, [client]);

  return <>{children}</>;
};
