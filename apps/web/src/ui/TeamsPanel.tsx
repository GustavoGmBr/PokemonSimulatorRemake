import { useEffect, useState } from 'react';
import { MAX_TEAM_NAME, MAX_TEAMS, type TeamView } from '@pokesim/engine';
import { api } from '../api.ts';
import { Menu, type MenuItem } from './Menu.tsx';
import { Sprite } from './bits.tsx';
import { TextPrompt } from './TextPrompt.tsx';
import { playSound } from '../sound.ts';

type Step = { kind: 'list' } | { kind: 'actions'; id: string } | { kind: 'name'; id: string | null };

/** Equipes nomeadas: guarda a equipe atual com um nome e monta qualquer uma delas com um clique. */
export function TeamsPanel({ saveId, paused, onBack, onChanged }: { saveId: string; paused: boolean; onBack: () => void; onChanged: () => void }) {
  const [teams, setTeams] = useState<TeamView[] | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [hover, setHover] = useState('');
  const [note, setNote] = useState('Monte sua equipe no PC, salve com um nome e troque quando quiser.');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.teams(saveId).then(setTeams, (e: Error) => setNote(e.message)); }, [saveId]);

  const run = async (job: () => Promise<TeamView[]>, ok: string, changedTeam = false) => {
    setBusy(true);
    try {
      setTeams(await job());
      setNote(ok);
      playSound('save');
      if (changedTeam) onChanged();
    } catch (e) {
      setNote((e as Error).message);
      playSound('error');
    } finally {
      setBusy(false);
      setStep({ kind: 'list' });
    }
  };

  if (step.kind === 'name') {
    const current = teams?.find((t) => t.id === step.id);
    return (
      <TextPrompt
        label={step.id ? 'Novo nome da equipe' : 'Nome da nova equipe'}
        initial={current?.name ?? ''} maxLength={MAX_TEAM_NAME} placeholder="Ex.: Time de Fogo"
        onCancel={() => setStep({ kind: 'list' })}
        onSubmit={(name) => {
          if (!name.trim()) { setStep({ kind: 'list' }); return; }
          const id = step.id;
          void run(() => (id ? api.teamUpdate(saveId, id, { name }) : api.teamCreate(saveId, name)), id ? 'Equipe renomeada.' : `Equipe "${name.trim()}" salva!`);
        }}
      />
    );
  }

  const selected = teams?.find((t) => t.id === (step.kind === 'actions' ? step.id : hover));
  const listItems: MenuItem[] = [
    { id: '__new', label: '+ Salvar equipe atual', extra: `${teams?.length ?? 0}/${MAX_TEAMS}` },
    ...(teams ?? []).map((team): MenuItem => ({ id: team.id, label: team.name, extra: team.active ? 'montada ✓' : `${team.members.length} Pokémon` })),
    { id: '__back', label: 'Voltar' },
  ];
  const actionItems: MenuItem[] = selected ? [
    { id: 'apply', label: 'Montar esta equipe', disabled: selected.active },
    { id: 'overwrite', label: 'Regravar com a equipe atual' },
    { id: 'rename', label: 'Renomear' },
    { id: 'delete', label: 'Apagar' },
    { id: '__back', label: 'Voltar' },
  ] : [];

  return (
    <section className="gb-window" aria-labelledby="teams-title">
      <h2 id="teams-title" className="gb-title" style={{ marginBottom: 10 }}>{step.kind === 'actions' && selected ? selected.name : 'Equipes'}</h2>
      <p style={{ margin: '0 0 8px' }}>{note}</p>
      {teams === null ? <p className="gb-muted">Carregando…</p> : null}
      {teams && step.kind === 'list' ? (
        <Menu label="Equipes" items={listItems} active={!paused && !busy} onMove={setHover} onBack={onBack}
          onSelect={(id) => {
            if (id === '__back') onBack();
            else if (id === '__new') setStep({ kind: 'name', id: null });
            else setStep({ kind: 'actions', id });
          }}
        />
      ) : null}
      {teams && step.kind === 'actions' && selected ? (
        <Menu label="Ações da equipe" items={actionItems} active={!paused && !busy} onBack={() => setStep({ kind: 'list' })}
          onSelect={(id) => {
            if (id === '__back') setStep({ kind: 'list' });
            else if (id === 'rename') setStep({ kind: 'name', id: selected.id });
            else if (id === 'apply') void run(() => api.teamApply(saveId, selected.id), `${selected.name} montada! Quem saiu foi para o PC.`, true);
            else if (id === 'overwrite') void run(() => api.teamUpdate(saveId, selected.id, { useCurrent: true }), 'Equipe regravada com os Pokémon atuais.');
            else void run(() => api.teamDelete(saveId, selected.id), 'Equipe apagada (os Pokémon continuam com você).');
          }}
        />
      ) : null}
      {selected ? (
        <div className="gb-row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }} aria-label="Integrantes">
          {selected.members.map((m) => (
            <span key={m.id} className="gb-teamrow" title={`${m.name} Nv${m.level}`}><Sprite speciesId={m.spriteId} shiny={m.shiny} alt={m.name} size={56} /><span className="gb-muted">Nv{m.level}</span></span>
          ))}
          {selected.members.length === 0 ? <span className="gb-muted">Todos os Pokémon desta equipe foram embora.</span> : null}
        </div>
      ) : null}
    </section>
  );
}
