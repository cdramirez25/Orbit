import { Eraser, Mic, Square } from 'lucide-react';

import { Button, IconButton } from '@/components/ui';
import { LOCALE_NAMES } from '@/i18n/messages';
import { useT } from '@/i18n/useT';
import { listenErrorKey } from '@/lib/audio/listen-error';
import { MODEL_NAME_KEY } from '@/lib/audio/stt-models';
import { cn } from '@/lib/utils/cn';
import { useAudioStore } from '@/stores/audio.store';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useTranscriptStore } from '@/stores/transcript.store';

/**
 * La pantalla de transcripción: un botón para escuchar y, debajo, lo que el modelo de voz va
 * entendiendo, con el modelo y el idioma en uso. Para probar que se transcribe bien (y si no, cambiar
 * de modelo en Ajustes, Audio). No tiene nada de IA: es solo voz a texto.
 */
export function Expanded() {
  const t = useT();
  const listening = useAudioStore((s) => s.listening);
  const errorCode = useAudioStore((s) => s.errorCode);
  const toggleListening = useAudioStore((s) => s.toggleListening);
  const lines = useTranscriptStore((s) => s.lines);
  const partial = useTranscriptStore((s) => s.partial);
  const clear = useTranscriptStore((s) => s.clear);
  const activeModel = useModelStore((s) => s.status?.active);
  const language = useSettingsStore((s) => s.sttLanguage);

  const empty = lines.length === 0 && partial === '';
  const errorKey = errorCode ? listenErrorKey(errorCode, true) : null;
  const languageName = language === 'auto' ? t('stt.language.auto') : LOCALE_NAMES[language];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">
            {t('listen.module')}
          </span>
          <span
            role="status"
            className={cn(
              'rounded-full bg-white/8 px-2 py-0.5 text-[10px]',
              listening ? 'text-accent' : 'text-ink-dim',
            )}
          >
            {t(listening ? 'listen.status.on' : 'listen.status.off')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={listening ? 'danger' : 'primary'}
            onClick={() => void toggleListening()}
          >
            {listening ? (
              <Square aria-hidden className="size-3 fill-current" />
            ) : (
              <Mic aria-hidden className="size-3" />
            )}
            {t(listening ? 'listen.action.stop' : 'listen.action.start')}
          </Button>
          <IconButton label={t('listen.action.clear')} disabled={empty} onClick={clear}>
            <Eraser aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <p className="text-[11px] text-ink-faint">
        {t('listen.model')}:{' '}
        <span className="text-ink-dim">{activeModel ? t(MODEL_NAME_KEY[activeModel]) : '…'}</span>
        {' · '}
        {t('listen.language')}: <span className="text-ink-dim">{languageName}</span>
      </p>

      {errorKey && (
        <p role="alert" className="text-[12px] leading-snug text-danger">
          {t(errorKey)}
        </p>
      )}

      {empty ? (
        <p className="text-[13px] leading-snug text-ink-faint">
          {t(listening ? 'transcript.waiting' : 'listen.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {lines.map((line) => (
            <p key={line.id} className="text-[15px] leading-snug text-ink">
              {line.text}
            </p>
          ))}
          {partial !== '' && <p className="text-[15px] leading-snug text-ink-dim">{partial}</p>}
        </div>
      )}

      <p className="text-[11px] leading-snug text-ink-faint">{t('listen.hint')}</p>
    </div>
  );
}
