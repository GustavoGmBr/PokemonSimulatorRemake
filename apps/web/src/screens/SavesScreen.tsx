import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SaveSummary } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from '../ui/Menu.tsx';
import { DialogBox } from '../ui/DialogBox.tsx';
import { KeyHints, Sprite, formatMoney, formatPlayTime } from '../ui/bits.tsx';

type Mode = 'list' | 'actions' | 'confirm-delete';
const NEW_GAME = '__new__';
const OPTIONS = '__options__';
const IMPORT = '__import__';

interface Props {
  onContinue: (saveId: string) => void;
  onNewGame: () => void;
  onOptions: () => void;
}

export function SavesScreen({ onContinue, onNewGame, onOptions }: Props) {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(NEW_GAME);
  const [mode, setMode] = useState<Mode>('list');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [backups, setBackups] = useState<{ dir: string | null; count: number; last: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    api.listSaves().then((list) => {
      setSaves(list);
      // o cursor começa na jornada mais recente
      setSelectedId((current) => (current === NEW_GAME && list[0] ? list[0].id : current));
    }, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.backups().then((b) => setBackups({ dir: b.dir, count: b.backups.length, last: b.backups[0]?.createdAt ?? null }), () => undefined);
  }, []);

  const exportSelected = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const data = await api.exportSave(selected.id);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `pokesim-${selected.trainerName.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice(`Save de ${selected.trainerName.toUpperCase()} exportado. Guarde o arquivo em um lugar seguro.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setMode('list');
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const imported = await api.importSave(JSON.parse(await file.text()));
      setNotice(`Save de ${imported.trainerName.toUpperCase()} importado como uma nova jornada.`);
      setSelectedId(imported.id);
      load();
    } catch (e) {
      setError(e instanceof SyntaxError ? 'O arquivo não é um save válido (JSON inválido).' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selected = saves?.find((save) => save.id === selectedId) ?? null;

  const items = useMemo<MenuItem[]>(() => [
    ...(saves ?? []).map((save) => ({
      id: save.id,
      label: save.trainerName,
      extra: `${save.badges} insígnias`,
    })),
    { id: NEW_GAME, label: 'Novo jogo' },
    { id: IMPORT, label: 'Importar save' },
    { id: OPTIONS, label: 'Opções' },
  ], [saves]);

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.deleteSave(selected.id);
      setMode('list');
      setSelectedId(NEW_GAME);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const message = error
    ? error
    : notice && mode === 'list'
      ? notice
    : saves === null
      ? 'Carregando suas jornadas…'
      : mode === 'actions' && selected
        ? `O que fazer com a jornada de ${selected.trainerName.toUpperCase()}?`
        : mode === 'confirm-delete' && selected
          ? `Excluir a jornada de ${selected.trainerName.toUpperCase()}? Isso não pode ser desfeito.`
          : saves.length === 0
            ? 'Nenhuma jornada salva ainda. Escolha NOVO JOGO para começar!'
            : 'Escolha uma jornada para continuar ou comece uma nova.';

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window gb-window--sky" style={{ textAlign: 'center', padding: '22px 16px' }}>
          <h1 className="gb-title gb-title--shadow" style={{ fontSize: 48, letterSpacing: 4 }}>Pokémon Simulator</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--ink)', fontSize: 22 }}>Remake · v2.0 alpha</p>
        </header>

        <div className="gb-row">
          <section className="gb-window gb-side" aria-labelledby="saves-title" style={{ maxWidth: 380 }}>
            <h2 id="saves-title" className="gb-title" style={{ marginBottom: 10 }}>Jornadas</h2>
            {saves ? (
              <Menu
                label="Jornadas salvas"
                items={items}
                active={mode === 'list' && !busy}
                initialId={selectedId}
                onMove={setSelectedId}
                onSelect={(id) => (id === NEW_GAME ? onNewGame() : id === OPTIONS ? onOptions() : id === IMPORT ? fileInput.current?.click() : setMode('actions'))}
              />
            ) : null}
          </section>

          <section className="gb-window gb-grow" aria-label="Detalhes da jornada">
            {selected ? <SavePreview save={selected} /> : <NewGamePreview />}
          </section>
        </div>

        <div className="gb-row" style={{ alignItems: 'stretch' }}>
          <div className="gb-grow">
            <DialogBox pages={[message]} active={false} />
          </div>
          {mode === 'actions' && selected ? (
            <div className="gb-window gb-side" style={{ maxWidth: 300 }}>
              <Menu
                label="Ações da jornada"
                items={[
                  { id: 'continue', label: 'Continuar' },
                  { id: 'export', label: 'Exportar save' },
                  { id: 'delete', label: 'Excluir' },
                  { id: 'back', label: 'Voltar' },
                ]}
                onSelect={(id) => {
                  if (id === 'continue') onContinue(selected.id);
                  else if (id === 'export') void exportSelected();
                  else if (id === 'delete') setMode('confirm-delete');
                  else setMode('list');
                }}
                onBack={() => setMode('list')}
              />
            </div>
          ) : null}
          {mode === 'confirm-delete' && selected ? (
            <div className="gb-window gb-side" style={{ maxWidth: 300 }}>
              <Menu
                label="Confirmar exclusão"
                items={[{ id: 'no', label: 'Não' }, { id: 'yes', label: 'Sim, excluir' }]}
                active={!busy}
                onSelect={(id) => (id === 'yes' ? void remove() : setMode('actions'))}
                onBack={() => setMode('actions')}
              />
            </div>
          ) : null}
        </div>

        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importFile(file); }} />
        {backups && backups.count > 0 ? (
          <p className="gb-hint" style={{ margin: 0 }}>
            Backup automático a cada abertura: {backups.count} cópia{backups.count > 1 ? 's' : ''} (a última em {new Date(backups.last ?? '').toLocaleString('pt-BR')}) na pasta {backups.dir}.
          </p>
        ) : null}
        {error ? (
          <div>
            <button type="button" className="gb-button" onClick={load}>Tentar de novo</button>
          </div>
        ) : null}
        <KeyHints hints={[['↑↓', 'mover'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}

function SavePreview({ save }: { save: SaveSummary }) {
  return (
    <div className="gb-stack">
      <div className="gb-spread">
        <h2 className="gb-title" style={{ fontSize: 30 }}>{save.trainerName}</h2>
        <span className="gb-muted">{formatPlayTime(save.playTimeSeconds)}</span>
      </div>
      <div className="gb-grid-3" style={{ fontSize: 24 }}>
        <span>{formatMoney(save.money)}</span>
        <span>INSÍGNIAS {save.badges}</span>
        <span>POKÉDEX {save.pokedexCaught}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0' }}>
        {save.teamPreview.map((mon, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <Sprite speciesId={mon.speciesId} shiny={mon.shiny} alt={`Pokémon nível ${mon.level}`} size={80} />
            <div className="gb-muted" style={{ fontSize: 20 }}>Nv{mon.level}</div>
          </div>
        ))}
      </div>
      <span className="gb-hint">Iniciada em {new Date(save.createdAt).toLocaleDateString('pt-BR')}</span>
    </div>
  );
}

function NewGamePreview() {
  return (
    <div className="gb-stack" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200, textAlign: 'center' }}>
      <div className="gb-bob" aria-hidden="true" style={{ display: 'flex', gap: 12 }}>
        <Sprite speciesId={1} alt="" size={96} />
        <Sprite speciesId={4} alt="" size={96} />
        <Sprite speciesId={7} alt="" size={96} />
      </div>
      <p style={{ margin: 0, fontSize: 26 }}>Uma nova jornada começa aqui.</p>
      <p className="gb-hint" style={{ margin: 0 }}>Escolha seu nome e seu primeiro parceiro entre as nove regiões.</p>
    </div>
  );
}
