import { DialogBox } from '../ui/DialogBox.tsx';
import { FilterPanel, type FilterRow } from '../ui/FilterPanel.tsx';
import { KeyHints } from '../ui/bits.tsx';
import { playSound } from '../sound.ts';
import { TEXT_SPEEDS, TEXT_SPEED_LABEL, updateSettings, useSettings } from '../settings.ts';

const VOLUME_LABEL = ['Mudo', 'Baixo', 'Médio', 'Alto'] as const;

export function OptionsScreen({ onBack }: { onBack: () => void }) {
  const settings = useSettings();

  const rows: FilterRow[] = [
    { id: 'speed', label: 'Texto', value: TEXT_SPEED_LABEL[settings.textSpeed], kind: 'cycle' },
    { id: 'volume', label: 'Efeitos sonoros', value: VOLUME_LABEL[settings.volume], kind: 'cycle' },
    { id: 'test', label: 'Testar som', value: '', kind: 'action' },
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
          <FilterPanel
            title="Preferências"
            rows={rows}
            active
            onCycle={onCycle}
            onAction={(id) => (id === 'test' ? playSound('save') : onBack())}
            onBack={onBack}
          />
        </div>
        <DialogBox key={settings.textSpeed} pages={['Assim o texto aparece nas conversas e avisos do jogo.']} active={false} />
        <p className="gb-hint" style={{ color: 'var(--paper)' }}>As opções ficam salvas neste navegador.</p>
        <KeyHints hints={[['↑↓', 'linha'], ['←→', 'valor'], ['Z', 'confirmar'], ['X', 'voltar']]} />
      </div>
    </main>
  );
}
