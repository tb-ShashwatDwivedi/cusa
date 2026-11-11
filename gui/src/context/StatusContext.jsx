import { createContext, useContext } from 'react';
import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';

const StatusContext = createContext(null);

/** Single shared /api/status poll for shell + pages (avoids duplicate traffic). */
export function StatusProvider({ children }) {
  const value = usePoll(api.status, 8000);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useAgentStatus() {
  const ctx = useContext(StatusContext);
  if (!ctx) {
    return { data: null, error: null, loading: true };
  }
  return ctx;
}
