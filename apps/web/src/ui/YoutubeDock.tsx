import { useEffect, useState, type ReactElement } from 'react';
import { embedUrl } from './youtube-url.ts';
import { getSettings, updateSettings } from '../settings.ts';

const STORAGE_KEY = 'pokesim.youtube.v1';

interface Saved { url: string; open: boolean }

function load(): Saved {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Saved>;
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      open: typeof parsed.open === 'boolean' ? parsed.open : window.innerWidth >= 1000,
    };
  } catch {
    return { url: '', open: window.innerWidth >= 1000 };
  }
}

function save(value: Saved): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* sem armazenamento */ }
}

/** Player do YouTube flutuante no canto superior esquerdo: música própria, vídeos ou lives enquanto joga. */
export function YoutubeDock(): ReactElement {
  const [saved, setSaved] = useState<Saved>(load);
  const [draft, setDraft] = useState(saved.url);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [restoreMusic, setRestoreMusic] = useState<number | null>(null);
  const src = embedUrl(saved.url);

  // Com o painel aberto em telas médias, o jogo ganha uma margem à esquerda para não ficar por baixo dele.
  useEffect(() => {
    document.documentElement.dataset.yt = saved.open ? 'open' : 'closed';
    return () => { delete document.documentElement.dataset.yt; };
  }, [saved.open]);

  const change = (next: Saved) => { setSaved(next); save(next); };
  const play = () => {
    if (!embedUrl(draft)) { setError('Cole um link do YouTube (vídeo, live ou playlist).'); return; }
    setError('');
    change({ url: draft.trim(), open: true });
    setStarted(true);
  };
  const stop = () => { setStarted(false); };
  const toggleGameMusic = () => {
    if (restoreMusic === null) {
      setRestoreMusic(getSettings().music);
      updateSettings({ music: 0 });
    } else {
      updateSettings({ music: restoreMusic as 0 | 1 | 2 | 3 });
      setRestoreMusic(null);
    }
  };

  return (
    <div className="gb-yt" role="complementary" aria-label="Player do YouTube">
      <button type="button" className="gb-yt__tab" aria-expanded={saved.open} onClick={() => change({ ...saved, open: !saved.open })}>
        {saved.open ? '▾ Vídeo' : '▸ Vídeo'}{started && !saved.open ? ' ♪' : ''}
      </button>
      <div className="gb-yt__panel" hidden={!saved.open}>
        <div className="gb-yt__screen">
          {started && src ? (
            <iframe
              className="gb-yt__frame"
              src={src}
              title="Player do YouTube"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <p className="gb-yt__empty">Cole um link do YouTube abaixo para tocar música, vídeos ou lives enquanto joga.</p>
          )}
        </div>
        <form className="gb-yt__form" onSubmit={(event) => { event.preventDefault(); play(); }}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Link do vídeo (YouTube)"
            aria-label="Link do vídeo do YouTube"
            spellCheck={false}
          />
          <button type="submit" aria-label="Tocar">▶</button>
          {started && <button type="button" onClick={stop} aria-label="Parar">■</button>}
        </form>
        {error && <p className="gb-yt__error" role="alert">{error}</p>}
        <label className="gb-yt__check">
          <input type="checkbox" checked={restoreMusic !== null} onChange={toggleGameMusic} /> Silenciar a música do jogo
        </label>
      </div>
    </div>
  );
}
