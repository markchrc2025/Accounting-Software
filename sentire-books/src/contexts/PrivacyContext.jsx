import { createContext, useContext, useState, useEffect } from 'react';

const PrivacyContext = createContext({ isPrivate: false, togglePrivacy: () => {} });

const STORAGE_KEY = 'scalebooks.privacy';

export function PrivacyProvider({ children }) {
  const [isPrivate, setIsPrivate] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(isPrivate)); } catch {}
  }, [isPrivate]);

  function togglePrivacy() { setIsPrivate(p => !p); }

  return (
    <PrivacyContext.Provider value={{ isPrivate, togglePrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
