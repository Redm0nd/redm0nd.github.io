(function() {
  'use strict';

  // Theme management
  const STORAGE_KEY = 'theme-preference';
  const THEME_AUTO = 'auto';
  const THEME_LIGHT = 'light';
  const THEME_DARK = 'dark';

  function getStoredTheme() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function setStoredTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT;
  }

  function getActiveTheme() {
    const stored = getStoredTheme();
    if (stored === THEME_AUTO || !stored) {
      return getSystemTheme();
    }
    return stored;
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    const stored = getStoredTheme();

    if (stored === THEME_AUTO || !stored) {
      // Remove data-theme attribute to let CSS media queries handle it
      root.removeAttribute('data-theme');
    } else {
      // Set explicit theme
      root.setAttribute('data-theme', theme);
    }
  }

  function updateToggleButton() {
    const button = document.querySelector('.theme-toggle');
    if (!button) return;

    const stored = getStoredTheme();
    const active = getActiveTheme();

    if (stored === THEME_AUTO || !stored) {
      button.textContent = `🌓 Auto (${active === THEME_DARK ? 'Dark' : 'Light'})`;
    } else {
      button.textContent = active === THEME_DARK ? '🌙 Dark' : '☀️ Light';
    }
  }

  function cycleTheme() {
    const stored = getStoredTheme();
    let nextTheme;

    if (!stored || stored === THEME_AUTO) {
      // Auto -> Light
      nextTheme = THEME_LIGHT;
    } else if (stored === THEME_LIGHT) {
      // Light -> Dark
      nextTheme = THEME_DARK;
    } else {
      // Dark -> Auto
      nextTheme = THEME_AUTO;
    }

    setStoredTheme(nextTheme);
    applyTheme(getActiveTheme());
    updateToggleButton();
  }

  function initTheme() {
    // Apply initial theme
    applyTheme(getActiveTheme());
    updateToggleButton();

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      const stored = getStoredTheme();
      if (stored === THEME_AUTO || !stored) {
        applyTheme(getActiveTheme());
        updateToggleButton();
      }
    });

    // Add event listener to toggle button
    const button = document.querySelector('.theme-toggle');
    if (button) {
      button.addEventListener('click', cycleTheme);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // Apply initial theme immediately to prevent flash
  applyTheme(getActiveTheme());
})();