import { useEffect, useRef, useState } from 'react';
import { TYPE_LABELS, type RegionId, type StarterOption, type StarterRegion } from '@pokesim/engine';
import { api } from '../api.ts';
import { DialogBox } from '../ui/DialogBox.tsx';
import { Menu } from '../ui/Menu.tsx';
import { KeyHints, Sprite, TypeBadge } from '../ui/bits.tsx';
import { useKeys } from '../ui/useKeys.ts';

type Step = 'intro' | 'name' | 'region' | 'starter' | 'confirm' | 'creating';

const MAX_NAME = 12;

interface Props {
  onCancel: () => void;
  onCreated: (saveId: string, welcome: string) => void;
}

export function NewGameScreen({ onCancel, onCreated }: Props) {
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('');
  const [regions, setRegions] = useState<StarterRegion[] | null>(null);
  const [regionId, setRegionId] = useState<RegionId>('kanto');
  const [starter, setStarter] = useState<StarterOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.starters().then(setRegions, (e: Error) => setError(e.message));
  }, []);

  const region = regions?.find((entry) => entry.region === regionId);
  const trainer = name.trim().toUpperCase();

  const create = async () => {
    if (!starter) return;
    setStep('creating');
    try {
      const save = await api.createSave({ trainerName: name.trim(), starterSpeciesId: starter.speciesId });
      onCreated(save.id, `${starter.name.toUpperCase()} entrou para a sua equipe! Boa jornada, ${trainer}!`);
    } catch (e) {
      setError((e as Error).message);
      setStep('name');
    }
  };

  let dialog: string[];
  switch (step) {
    case 'intro':
      dialog = [
        'Olá! Bem-vindo ao mundo dos POKÉMON!',
        'Eu sou o PROFESSOR. Estudo a relação entre pessoas e POKÉMON nas nove regiões.',
        'Antes de começarmos… qual é o seu nome?',
      ];
      break;
    case 'name':
      dialog = [error ?? 'Digite seu nome e confirme com ENTER.'];
      break;
    case 'region':
      dialog = [`Prazer, ${trainer}! De qual região vem o seu primeiro parceiro?`];
      break;
    case 'starter':
      dialog = [`Estes são os POKÉMON iniciais de ${region?.name.toUpperCase() ?? ''}. Qual deles vai com você?`];
      break;
    case 'confirm':
      dialog = starter
        ? [`Então você escolhe ${starter.name.toUpperCase()}, o POKÉMON tipo ${starter.types.map((t) => TYPE_LABELS[t].toUpperCase()).join('/')}?`]
        : [''];
      break;
    case 'creating':
      dialog = ['Preparando a sua jornada…'];
      break;
  }

  return (
    <main className="gb-screen">
      <div className="gb-stage" style={{ maxWidth: 980 }}>
        <section className="gb-window gb-window--sky" style={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {step === 'name' ? (
            <NameEntry
              value={name}
              onChange={(value) => { setName(value); setError(null); }}
              onConfirm={() => (name.trim() ? setStep('region') : setError('O nome não pode ficar vazio.'))}
              onBack={() => setStep('intro')}
            />
          ) : null}
          {step === 'region' && regions ? (
            <div className="gb-window" style={{ width: '100%', maxWidth: 560 }}>
              <h2 className="gb-title" style={{ marginBottom: 8 }}>Região</h2>
              <Menu
                label="Regiões"
                columns={2}
                initialId={regionId}
                items={regions.map((entry) => ({ id: entry.region, label: entry.name }))}
                onMove={setRegionId}
                onSelect={(id) => { setRegionId(id); setStep('starter'); }}
                onBack={() => setStep('name')}
              />
            </div>
          ) : null}
          {(step === 'starter' || step === 'confirm' || step === 'creating') && region ? (
            <StarterPicker
              key={region.region}
              starters={region.starters}
              active={step === 'starter'}
              initialId={starter?.speciesId}
              onPick={(option) => { setStarter(option); setStep('confirm'); }}
              onBack={() => setStep('region')}
            />
          ) : null}
          {step === 'intro' ? (
            <div className="gb-bob" aria-hidden="true" style={{ display: 'flex', gap: 16 }}>
              <Sprite speciesId={25} alt="" size={140} />
            </div>
          ) : null}
        </section>

        <div className="gb-row" style={{ alignItems: 'stretch' }}>
          <div className="gb-grow">
            <DialogBox
              pages={dialog}
              active={step === 'intro'}
              onFinish={step === 'intro' ? () => setStep('name') : undefined}
            />
          </div>
          {step === 'confirm' ? (
            <div className="gb-window gb-side" style={{ maxWidth: 240 }}>
              <Menu
                label="Confirmar inicial"
                items={[{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }]}
                onSelect={(id) => (id === 'yes' ? void create() : setStep('starter'))}
                onBack={() => setStep('starter')}
              />
            </div>
          ) : null}
        </div>

        <div className="gb-spread">
          <KeyHints hints={[['Z', 'confirmar'], ['X', 'voltar'], ['←→', 'escolher']]} />
          <button type="button" className="gb-button" onClick={onCancel} disabled={step === 'creating'}>
            Cancelar
          </button>
        </div>
      </div>
    </main>
  );
}

function NameEntry({ value, onChange, onConfirm, onBack }: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // pequeno atraso para o Z que fechou o diálogo não ser digitado no campo
  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 200);
    return () => window.clearTimeout(timer);
  }, []);
  useKeys((key) => {
    if (key === 'confirm') onConfirm();
    if (key === 'back') onBack();
  });
  return (
    <div className="gb-window" style={{ width: '100%', maxWidth: 520 }}>
      <label htmlFor="trainer-name" className="gb-title" style={{ display: 'block', marginBottom: 10 }}>Seu nome</label>
      <input
        id="trainer-name"
        ref={input}
        className="gb-input"
        value={value}
        maxLength={MAX_NAME}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="gb-spread" style={{ marginTop: 8 }}>
        <span className="gb-hint">Até {MAX_NAME} letras</span>
        <span className="gb-hint">{value.length}/{MAX_NAME}</span>
      </div>
    </div>
  );
}

function StarterPicker({ starters, active, initialId, onPick, onBack }: {
  starters: StarterOption[];
  active: boolean;
  initialId?: number;
  onPick: (starter: StarterOption) => void;
  onBack: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, starters.findIndex((s) => s.speciesId === initialId)));
  useKeys((key) => {
    if (key === 'left' || key === 'up') setIndex((i) => (i + starters.length - 1) % starters.length);
    else if (key === 'right' || key === 'down') setIndex((i) => (i + 1) % starters.length);
    else if (key === 'confirm') { const s = starters[index]; if (s) onPick(s); }
    else if (key === 'back') onBack();
  }, active);

  return (
    <div className="gb-grid-3" style={{ width: '100%' }} role="radiogroup" aria-label="Pokémon iniciais">
      {starters.map((option, i) => {
        const total = Object.values(option.baseStats).reduce((sum, v) => sum + v, 0);
        const current = i === index;
        return (
          <button
            key={option.speciesId}
            type="button"
            role="radio"
            aria-checked={current}
            className="gb-window"
            onMouseEnter={() => active && setIndex(i)}
            onClick={() => active && onPick(option)}
            style={{
              cursor: active ? 'pointer' : 'default',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              boxShadow: current ? 'inset 0 0 0 4px var(--red)' : undefined,
              background: current ? 'var(--paper)' : 'var(--paper-2)',
            }}
          >
            <div className={current && active ? 'gb-bob' : undefined}>
              <Sprite speciesId={option.speciesId} alt={option.name} size={140} />
            </div>
            <span className="gb-title" style={{ fontSize: 24 }}>{option.name}</span>
            <span style={{ display: 'flex', gap: 6 }}>{option.types.map((t) => <TypeBadge key={t} type={t} />)}</span>
            <span className="gb-hint">Total base {total}</span>
          </button>
        );
      })}
    </div>
  );
}
