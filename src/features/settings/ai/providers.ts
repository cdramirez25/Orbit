import {
  Container,
  Gem,
  MessageSquare,
  Server,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { MessageKey } from '@/i18n/messages';
import type { AiProviderId, AiProviderStatus } from '@/types';

export type AiProviderKind = 'cloud' | 'local';

export interface AiProvider {
  id: AiProviderId;
  /** Nombre de la marca: no se traduce. */
  name: string;
  /** En la nube (pide clave de API) o en el equipo del usuario (pide la dirección del servidor). */
  kind: AiProviderKind;
  icon: LucideIcon;
  description: MessageKey;
  /** Ejemplo de clave. Valor técnico, no se traduce; solo si el proveedor usa clave. */
  apiKeyPlaceholder?: string;
  /** Ejemplo de dirección. Valor técnico, no se traduce; solo si el proveedor usa servidor propio. */
  baseUrlPlaceholder?: string;
}

/** Proveedores de IA que el usuario puede configurar. Cada uno usa SU propia clave o servidor. */
export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    id: 'claude',
    name: 'Claude',
    kind: 'cloud',
    icon: Sparkles,
    description: 'ai.provider.claude.description',
    apiKeyPlaceholder: 'sk-ant-…',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    kind: 'cloud',
    icon: MessageSquare,
    description: 'ai.provider.chatgpt.description',
    apiKeyPlaceholder: 'sk-…',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'cloud',
    icon: Zap,
    description: 'ai.provider.groq.description',
    apiKeyPlaceholder: 'gsk_…',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    kind: 'cloud',
    icon: Gem,
    description: 'ai.provider.gemini.description',
    apiKeyPlaceholder: 'AIza…',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'local',
    icon: Server,
    description: 'ai.provider.ollama.description',
    baseUrlPlaceholder: 'http://localhost:11434',
  },
  {
    id: 'docker',
    name: 'Docker',
    kind: 'local',
    icon: Container,
    description: 'ai.provider.docker.description',
    baseUrlPlaceholder: 'http://localhost:12434/engines/v1',
  },
];

/** ¿Tiene lo necesario para funcionar? (clave si la pide, y un modelo elegido o por defecto). */
export function isProviderConfigured(
  provider: AiProvider,
  status: AiProviderStatus | undefined,
): boolean {
  if (!status) return false;
  const hasModel = Boolean(status.model ?? status.defaultModel);
  return hasModel && (provider.kind === 'local' || status.hasKey);
}
