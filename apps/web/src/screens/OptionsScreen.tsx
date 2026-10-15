import { useEffect, useState } from 'react';
import { DialogBox } from '../ui/DialogBox.tsx';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { KeyHints } from '../ui/bits.tsx';
import { playSound } from '../sound.ts';
import { BIND_ACTIONS, DEFAULT_KEYS, TEXT_SPEEDS, TEXT_SPEED_LABEL, keyLabel, updateSettings, useSettings, type BindAction } from '../settings.ts';

const VOLUME_LABEL = ['Mudo', 'Baixo', 'Médio', 'Alto'] as const;

/** Controles: escolha uma ação e aperte a nova tecla (Esc cancela). A tecla sai de qualquer outra ação que a usava. */
function ControlsPanel({ onBack }: { onBack: () => void }) {
  const settings = useSettings();
  const [waiting, setWaiting] = useState<BindAction | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setWaiting(null); return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const next = { ...settings.keys };
      for (const action of BIND_ACTIONS) next[action.id] = next[action.id].filter((k) => k.toLowerCase() !== key.toLowerCase());
      next[waiting] = [key];
      for (const action of BIND_ACTIONS) if (next[action.id].length === 0) next[action.id] = [...DEFAULT_KEYS[action.id]].filter((k) => k.toLowerCase() !== key.toLowerCase());
      updateSettings({ keys: next });
      playSound('confirm');
      setWaiting(null);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [waiting, settings.keys]);

  const rows: FilterRow[] = [
    ...BIND_ACTIONS.map((action): FilterRow => ({
      id: action.id,
      label: action.label,
      value: waiting === action.id ? 'Aperte uma tecla…' : settings.keys[action.id].map(keyLabel).join(' / '),
      kind: 'action',
    })),
    { id: 'reset', label: 'Restaurar padrão', value: '', kind: 'action' },
    { id: 'back', label: 'Voltar', value: '', kind: 'action' },
  ];
  return (
    <FilterPanel
      title="Controles"
      rows={rows}
      active={!waiting}
      onCycle={() => undefined}
      onAction={(id) => {
        if (id === 'back') onBack();
        else if (id === 'reset') updateSettings({ keys: DEFAULT_KEYS });
        else setWaiting(id as BindAction);
      }}
      onBack={onBack}
    />
  );
}

export function OptionsScreen({ onBack }: { onBack: () => void }) {
  const settings = useSettings();
  const [controls, setControls] = useState(false);

  const rows: FilterRow[] = [
    { id: 'speed', label: 'Texto', value: TEXT_SPEED_LABEL[settings.textSpeed], kind: 'cycle' },
    { id: 'volume', label: 'Efeitos sonoros', value: VOLUME_LABEL[settings.volume], kind: 'cycle' },
    { id: 'test', label: 'Testar som', value: '', kind: 'action' },
    { id: 'controls', label: 'Controles', value: 'Teclas', kind: 'action' },
    { id: 'back', label: 'Voltar', value: '', kind: 'action' },
  ];

  const onCycle = (id: string, direction: 1 | -1) => {
    if (id === 'speed') {
      const next = TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(settings.textSpeed) + direction + TEXT_SPEEDS.length) % TEXT_SPEEDS.length];
      if (next) updateSettings({ textSpeed: next });
    } else if (id === 'volume') {
      const next = ((settings.volume + direction + 4) % 4) as 0 | 1 | 2 | 3;
      updateSettings({ volume: next });
      queueMicrotask(() => playSound('confirm'));
    }
  };

  return (
    <main className="gb-screen">
      <div className="gb-stage">
        <header className="gb-window" style={{ padding: '10px 20px' }}>
          <h1 className="gb-title" style={{ fontSize: 26 }}>Opções</h1>
        </header>
        <div style={{ maxWidth: 560 }}>
          {controls ? <ControlsPanel onBack={() => setControls(false)} /> : (
            <FilterPanel
              title="Preferências"
              rows={rows}
              active
              onCycle={onCycle}
              onAction={(id) => (id === 'test' ? playSound('save') : id === 'controls' ? setControls(true) : onBack())}
              onBack={onBack}
            />
          )}
        </div>
        <DialogBox key={settings.textSpeed} pages={['Assim o texto aparece nas conversas e avisos do jogo.']} active={false} />
        <p className="gb-hint" style={{ color: 'var(--paper)' }}>As opções ficam salvas neste navegador.</p>
        <KeyHints hints={[['↑↓', 'linha'], ['←→', 'valor'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}
