// Theme toggle functionality
(function() {
  'use strict';

  const THEME_KEY = 'theme-preference';

  // Get theme preference from localStorage or system preference
  function getThemePreference() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) {
      return stored;
    }

    // Check system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Apply theme to document
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Update toggle button icon
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      const icon = toggleButton.querySelector('.theme-toggle-icon');
      if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
      }
    }
  }

  // Toggle between light and dark themes
  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  }

  // Initialize theme when DOM is loaded
  function initTheme() {
    const theme = getThemePreference();
    applyTheme(theme);

    // Add click listener to toggle button
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', toggleTheme);
    }

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
      // Only auto-switch if user hasn't manually set a preference
      const storedPreference = localStorage.getItem(THEME_KEY);
      if (!storedPreference) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // Initialize immediately if DOM is already loaded, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // Apply theme immediately to prevent flash
  const initialTheme = getThemePreference();
  document.documentElement.setAttribute('data-theme', initialTheme);
})();