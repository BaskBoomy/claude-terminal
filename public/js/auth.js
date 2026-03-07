// Store original fetch before any overrides
const _origFetch = window.fetch;

export async function initAuth() {
  try {
    const r = await _origFetch('/api/auth/check');
    const data = await r.json();
    if (!data.authenticated) {
      window.location.href = '/login.html';
      return false;
    }
  } catch (e) {
    // Network error — allow through (might be local access)
  }
  // Override global fetch to handle 401
  window.fetch = authFetch;
  return true;
}

export async function authFetch(url, options) {
  const r = await _origFetch(url, options);
  if (r.status === 401 && typeof url === 'string' && !url.includes('/api/auth/')) {
    window.location.href = '/login.html';
  }
  return r;
}
