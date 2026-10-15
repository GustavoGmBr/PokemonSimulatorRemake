import { useEffect, useMemo, useState } from 'react';
import type { SaveSummary } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { KeyHints, Sprite, formatMoney, formatPlayTime } from '../ui/bits.tsx';
import { CHANGELOG } from '../changelog.ts';

interface Props {
  onContinue: (saveId: string) => void;
  onSaves: () => void;
  onNewGame: () => void;
  onOptions: () => void;
}

const SEEN_KEY = 'pokesim.seenVersion';
const readSeen = (): string | null => { try { return window.localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (version: string) => { try { window.localStorage.setItem(SEEN_KEY, version); } catch { /* sem armazenamento */ } };

export function TitleScreen({ onContinue, onSaves, onNewGame, onOptions }: Props) {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen] = useState(readSeen);

  useEffect(() => {
    api.listSaves().then(setSaves, (e: Error) => setError(e.message));
    api.health().then((h) => setVersion(h.version ?? null), () => undefined);
  }, []);

  const last = useMemo(() => [...(saves ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null, [saves]);
  const isNew = version !== null && version !== 'dev' && seen !== version;
  // depois que a versão aparece uma vez, não é mais "nova"
  useEffect(() => { if (version && version !== 'dev') writeSeen(version); }, [version]);

  const items: MenuItem[] = [
    ...(last ? [{ id: 'continue', label: 'Continuar', extra: last.trainerName }] : []),
    { id: 'saves', label: last ? 'Jornadas' : 'Carregar jornada' },
    { id: 'new', label: 'Novo jogo' },
    { id: 'options', label: 'Opções' },
  ];
  const seenAt = seen ? CHANGELOG.findIndex((entry) => entry.version === seen) : -1;
  const shown = isNew ? CHANGELOG.slice(0, seenAt > 0 ? Math.min(seenAt, 3) : 2) : CHANGELOG.slice(0, 2);

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-window--sky" style={{ textAlign: 'center', padding: '28px 16px' }}>
          <h1 className="gb-title gb-title--shadow" style={{ fontSize: 52, letterSpacing: 4 }}>Pokémon Simulator</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--ink)', fontSize: 22 }}>Remake · {version && version !== 'dev' ? `v${version}` : 'v2.0 alpha'}</p>
        </header>

        <div className="gb-row">
          <section className="gb-window gb-side" style={{ maxWidth: 340 }} aria-label="Menu inicial">
            <Menu label="Menu inicial" items={items} active onSelect={(id) => (id === 'continue' && last ? onContinue(last.id) : id === 'new' ? onNewGame() : id === 'options' ? onOptions() : onSaves())} />
          </section>

          <section className="gb-window gb-grow" aria-label="Última jornada">
            {last ? (
              <div className="gb-stack">
                <div className="gb-spread">
                  <h2 className="gb-title" style={{ fontSize: 28 }}>{last.trainerName}</h2>
                  <span className="gb-muted">{formatPlayTime(last.playTimeSeconds)} · jogou em {new Date(last.updatedAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="gb-grid-3" style={{ fontSize: 24 }}>
                  <span>{formatMoney(last.money)}</span><span>INSÍGNIAS {last.badges}</span><span>POKÉDEX {last.pokedexCaught}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {last.teamPreview.map((mon, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <Sprite speciesId={mon.speciesId} shiny={mon.shiny} alt={`Pokémon nível ${mon.level}`} size={72} />
                      <div className="gb-muted" style={{ fontSize: 20 }}>Nv{mon.level}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0 }}>{error ?? (saves === null ? 'Carregando…' : 'Nenhuma jornada salva ainda. Escolha NOVO JOGO para começar!')}</p>
            )}
          </section>
        </div>

        <section className="gb-window" aria-label="Novidades">
          <h2 className="gb-title" style={{ fontSize: 22, marginBottom: 8 }}>Novidades {isNew ? <span className="gb-banner" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 16 }}>Atualizado!</span> : null}</h2>
          {shown.map((entry) => (
            <div key={entry.version} style={{ marginBottom: 8 }}>
              <strong>v{entry.version}</strong>
              <ul style={{ margin: '2px 0 0', paddingLeft: 22 }}>{entry.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ))}
        </section>
        <KeyHints hints={[['↑↓', 'mover'], ['Z', 'confirmar']]} />
      </div>
    </main>
  );
}
