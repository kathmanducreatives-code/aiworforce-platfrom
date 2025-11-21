import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ClientBranding {
  id: string;
  client_name: string;
  company_display_name: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

interface ClientContextType {
  client: ClientBranding | null;
  loading: boolean;
  refreshClient: () => Promise<void>;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [client, setClient] = useState<ClientBranding | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClientBranding = async () => {
    if (!user) {
      setClient(null);
      setLoading(false);
      return;
    }

    try {
      // Get user's profile to find client_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('client_id')
        .eq('user_id', user.id)
        .single();

      if (profileError || !profile?.client_id) {
        setClient(null);
        setLoading(false);
        return;
      }

      // Get client branding
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('id, client_name, company_display_name, logo_url, primary_color, secondary_color, accent_color')
        .eq('id', profile.client_id)
        .single();

      if (clientError) throw clientError;

      setClient(clientData);
    } catch (error) {
      console.error('Error fetching client branding:', error);
      setClient(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientBranding();
  }, [user]);

  const value = {
    client,
    loading,
    refreshClient: fetchClientBranding,
  };

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const context = useContext(ClientContext);
  if (context === undefined) {
    throw new Error('useClient must be used within a ClientProvider');
  }
  return context;
};
