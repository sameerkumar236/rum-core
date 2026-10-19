import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

function readSavedTheme() {
  try {
    const saved = localStorage.getItem('rum-theme');
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readSavedTheme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const theme = preference || (systemDark ? 'dark' : 'light');

  const setTheme = useCallback((value) => {
    setPreference(value);
    try {
      localStorage.setItem('rum-theme', value);
    } catch {
      // The theme still works when browser storage is unavailable.
    }
  }, []);
  const toggleTheme = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#18181b' : '#ffffff');
  }, [theme]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleTheme();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
