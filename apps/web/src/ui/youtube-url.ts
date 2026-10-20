/** Transforma um link do YouTube (vídeo, live, short ou playlist) na URL do player incorporado. */
export function embedUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const base = 'https://www.youtube-nocookie.com/embed';
  const flags = 'autoplay=1&rel=0&playsinline=1';
  const idOk = (id: string | undefined | null): id is string => Boolean(id && /^[\w-]{6,20}$/.test(id));
  const list = url.searchParams.get('list');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, second] = url.pathname.split('/');
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (kind === 'live' || kind === 'shorts' || kind === 'embed') id = second ?? null;
  } else return null;
  if (idOk(id)) return `${base}/${id}?${flags}${idOk(list) ? `&list=${list}` : ''}`;
  if (idOk(list)) return `${base}/videoseries?list=${list}&${flags}`;
  return null;
}
