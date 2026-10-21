import { Mic, SendHorizontal, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, IconButton, Input } from '@/components/ui';
import { useT } from '@/i18n/useT';
import { questionErrorKey } from '@/lib/ai/question-error';
import { Answer } from '@/modules/prompter/Answer';
import { SessionBar } from '@/modules/prompter/SessionBar';
import { Transcript } from '@/modules/prompter/Transcript';
import { useAnswerStore } from '@/stores/answer.store';
import { useAudioStore } from '@/stores/audio.store';
import { useQuestionStore } from '@/stores/question.store';
import { useTranscriptStore } from '@/stores/transcript.store';

/** El botón de la pregunta: grabar, y mientras se graba, terminar y responder (o cancelar). */
function RecordControls() {
  const t = useT();
  const recording = useQuestionStore((s) => s.recording);
  const busy = useQuestionStore((s) => s.busy);
  const start = useQuestionStore((s) => s.start);
  const finish = useQuestionStore((s) => s.finish);
  const cancel = useQuestionStore((s) => s.cancel);

  if (!recording) {
    return (
      <Button variant="primary" size="sm" disabled={busy} onClick={() => void start()}>
        <Mic aria-hidden className="size-3.5" />
        {t('prompter.record')}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span
        role="status"
        aria-label={t('prompter.recording')}
        title={t('prompter.recording')}
        className="orbit-pulse mr-1 size-2 rounded-full bg-danger"
      />
      <Button variant="primary" size="sm" disabled={busy} onClick={() => void finish()}>
        <Square aria-hidden className="size-3 fill-current" />
        {t('prompter.finish')}
      </Button>
      <IconButton label={t('prompter.cancel')} disabled={busy} onClick={() => void cancel()}>
        <X aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );
}

/**
 * Escribir la pregunta en vez de grabarla: Enter (o el botón) se la manda a la IA, con el contexto
 * de la sesión. La isla solo recibe el teclado mientras el campo está en uso, para no quitarle el
 * foco a la videollamada el resto del tiempo.
 */
function AskInput() {
  const t = useT();
  const recording = useQuestionStore((s) => s.recording);
  const ask = useQuestionStore((s) => s.ask);
  const setKeyboard = useQuestionStore((s) => s.setKeyboard);
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const ready = text.trim() !== '' && !recording;

  // Al cerrarse la tarjeta, el teclado vuelve a la app de antes.
  useEffect(() => () => void setKeyboard(false), [setKeyboard]);

  const submit = () => {
    if (!ready) return;
    void ask(text);
    setText('');
    field.current?.blur(); // el teclado vuelve enseguida a la app de antes
  };

  return (
    <form
      className="mb-2 flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        ref={field}
        aria-label={t('prompter.type.aria')}
        placeholder={t('prompter.type.placeholder')}
        autoComplete="off"
        spellCheck={false}
        value={text}
        disabled={recording}
        onPointerDown={() => void setKeyboard(true)}
        onFocus={() => void setKeyboard(true)}
        onBlur={() => void setKeyboard(false)}
        onChange={(event) => setText(event.target.value)}
      />
      <IconButton type="submit" label={t('prompter.type.send')} disabled={!ready}>
        <SendHorizontal aria-hidden className="size-3.5" />
      </IconButton>
    </form>
  );
}

/** Por qué no se pudo grabar o responder (falta el permiso, no se oyó nada…). */
function RecordError() {
  const t = useT();
  const errorCode = useQuestionStore((s) => s.errorCode);
  if (!errorCode) return null;
  return (
    <p role="alert" className="mb-2 text-[11px] leading-snug text-danger">
      {t(questionErrorKey(errorCode))}
    </p>
  );
}

/**
 * La IA en la isla: la sesión activa, lo que se oye al grabar la pregunta, la respuesta (con el
 * contexto de toda la sesión) y el botón para grabar la pregunta y responderla.
 */
export function Expanded() {
  const t = useT();
  const recording = useQuestionStore((s) => s.recording);
  const asked = useAnswerStore((s) => s.question !== null);
  const listening = useAudioStore((s) => s.listening);
  const hasTranscript = useTranscriptStore((s) => s.lines.length > 0 || s.partial !== '');

  // Grabando se ve lo que se oye; después, la respuesta; sin nada, cómo se usa.
  let body = <p className="text-[12px] leading-snug text-ink-faint">{t('prompter.hint')}</p>;
  if (recording) body = <Transcript />;
  else if (asked) body = <Answer />;
  else if (listening || hasTranscript) body = <Transcript />;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <SessionBar />
        <RecordControls />
      </div>
      <AskInput />
      <RecordError />
      {body}
    </div>
  );
}
