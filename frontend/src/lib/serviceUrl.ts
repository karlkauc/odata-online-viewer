/** Origin (`https://host:port`) of a service URL as the backend reads it; bare hosts get https. */
export function urlOrigin(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

/** `https://user:pw@host/…` → the URL without them plus the credentials; null when there are none. */
export function splitCredentials(url: string): { url: string; username: string; password: string } | null {
  try {
    const parsed = new URL(url.trim());
    if (!parsed.username && !parsed.password) return null;
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    parsed.username = "";
    parsed.password = "";
    return { url: parsed.toString(), username, password };
  } catch {
    return null;
  }
}
