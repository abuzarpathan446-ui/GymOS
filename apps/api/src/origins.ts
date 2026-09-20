// Trust explicit deployment configuration, never a browser-supplied Host header.
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const entries = [
    env.APP_ORIGIN ?? 'http://localhost:5173',
    ...(env.ALLOWED_ORIGINS ?? '').split(','),
  ].map(value => value.trim()).filter(Boolean);
  return new Set(entries.map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('APP_ORIGIN and ALLOWED_ORIGINS must contain HTTP(S) origins without paths or credentials.');
    return url.origin;
  }));
}
