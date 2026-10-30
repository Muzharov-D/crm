/* Apply the saved theme before first paint without allowing inline scripts. */
(() => {
  try {
    const theme = localStorage.getItem('crm:theme');
    if (theme !== 'system') {
      document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    }
  } catch {}
})();
