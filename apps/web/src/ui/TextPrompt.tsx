import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  initial?: string;
  maxLength: number;
  placeholder?: string;
  submitLabel?: string;
  /** Enter confirma; string vazia é permitida (limpa o campo) */
  onSubmit: (value: string) => void;
  onCancel: () => void;
  inputMode?: 'text' | 'numeric';
}

/** Janela com um campo de texto. Enter confirma, Esc cancela; as teclas não vazam para a tela de trás. */
export function TextPrompt({ label, initial = '', maxLength, placeholder, submitLabel = 'Confirmar', onSubmit, onCancel, inputMode = 'text' }: Props) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // O pequeno atraso evita que a tecla que abriu a janela (Z) seja digitada no campo.
    const timer = window.setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="gb-modal" role="dialog" aria-modal="true" aria-label={label}>
      <form
        className="gb-window gb-window--accent gb-modal__box"
        onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        }}
      >
        <label className="gb-label" htmlFor="gb-prompt-input" style={{ fontSize: 22 }}>{label}</label>
        <input
          id="gb-prompt-input"
          ref={input}
          className="gb-input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="gb-spread">
          <span className="gb-hint">Enter {submitLabel.toLowerCase()} · Esc cancela</span>
          <span style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="gb-button" onClick={onCancel}>Cancelar</button>
            <button type="submit" className="gb-button gb-button--red">{submitLabel}</button>
          </span>
        </div>
      </form>
    </div>
  );
}
