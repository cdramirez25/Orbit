import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Onboarding } from '@/features/onboarding/Onboarding';
import { useLocaleStore } from '@/i18n/locale.store';
import { commands } from '@/ipc/commands';
import { useAiStore } from '@/stores/ai.store';
import { useAudioStore } from '@/stores/audio.store';
import { useGuideStore } from '@/stores/guide.store';
import { useModelStore } from '@/stores/model.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutStore } from '@/stores/shortcuts.store';
import type { AiStatus, ModelStatus, PermissionStatus } from '@/types';

vi.mock('@/ipc/commands', () => ({
  commands: {
    getAudioPermission: vi.fn(),
    requestAudioPermission: vi.fn(),
    openAudioPermissionSettings: vi.fn(),
    aiGetStatus: vi.fn(),
    aiListModels: vi.fn(),
    setOnboardingDone: vi.fn(),
    sttModelDownload: vi.fn(),
    sttModelCancel: vi.fn(),
    sttModelRemove: vi.fn(),
    sttModelChooseDir: vi.fn(),
    sttModelResetDir: vi.fn(),
  },
}));

const mocked = vi.mocked(commands);

const model = (state: ModelStatus['state']): ModelStatus => ({
  state,
  downloaded: state === 'ready' ? 1000 : 0,
  total: 1000,
  error: null,
  dir: '/modelos',
  customDir: false,
});

const aiStatus = (active: AiStatus['active']): AiStatus => ({
  active,
  providers: [
    { id: 'groq', baseUrl: null, model: null, defaultModel: 'm', hasKey: active === 'groq' },
  ],
});

function setup(
  options: {
    permission?: PermissionStatus;
    model?: ModelStatus['state'];
    active?: AiStatus['active'];
  } = {},
) {
  const permission = options.permission ?? 'notDetermined';
  mocked.getAudioPermission.mockResolvedValue(permission);
  mocked.aiGetStatus.mockResolvedValue(aiStatus(options.active ?? null));
  mocked.aiListModels.mockResolvedValue([]);
  mocked.setOnboardingDone.mockResolvedValue({
    hideFromScreenShare: true,
    islandAnchor: 'center',
    freeOrigin: null,
    sttLanguage: 'auto',
    onboardingDone: true,
  });
  useAudioStore.setState({ permission });
  useModelStore.setState({ status: model(options.model ?? 'missing'), errorCode: null });
  useAiStore.setState({ status: aiStatus(options.active ?? null), models: {}, typedModels: {} });
  render(<Onboarding />);
}

const button = (name: string) => screen.getByRole('button', { name });
const next = async (name = 'Siguiente') => {
  fireEvent.click(button(name));
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLocaleStore.setState({ locale: 'es' });
  useGuideStore.setState({ visible: true });
  useSettingsStore.setState({ onboardingDone: false });
  useShortcutStore.setState({
    shortcuts: [
      {
        action: 'toggleQuestion',
        keys: 'CommandOrControl+Shift+Space',
        defaultKeys: 'CommandOrControl+Shift+Space',
        registered: true,
      },
      {
        action: 'toggleIsland',
        keys: 'CommandOrControl+Shift+H',
        defaultKeys: 'CommandOrControl+Shift+H',
        registered: true,
      },
    ],
  });
});

describe('guía de primer arranque', () => {
  it('empieza dando la bienvenida, sin botón de atrás, en el paso 1 de 5', async () => {
    setup();
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Bienvenido a Orbit' })).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();
    expect(screen.getByText(/Tu micrófono nunca se captura/)).toBeInTheDocument();
  });

  it('en Windows, donde no hay permiso de audio, tiene un paso menos', async () => {
    setup({ permission: 'notRequired' });
    await act(async () => {});
    expect(screen.getByText('Paso 1 de 4')).toBeInTheDocument();
    await next('Empezar');
    expect(screen.getByRole('heading', { name: 'Modelo de voz' })).toBeInTheDocument();
    expect(screen.getByText('Paso 2 de 4')).toBeInTheDocument();
  });

  it('el paso del permiso no deja seguir hasta que se concede, pero se puede saltar', async () => {
    setup({ permission: 'notDetermined' });
    await act(async () => {});
    await next('Empezar');

    expect(screen.getByRole('heading', { name: 'Permiso de audio' })).toBeInTheDocument();
    expect(button('Siguiente')).toBeDisabled();
    expect(button('Pedir permiso')).toBeInTheDocument();

    await next('Saltar este paso');
    expect(screen.getByRole('heading', { name: 'Modelo de voz' })).toBeInTheDocument();
  });

  it('con el permiso ya concedido el paso sale hecho y se puede seguir', async () => {
    setup({ permission: 'granted' });
    await act(async () => {});
    await next('Empezar');

    expect(screen.getByText('Permitido')).toBeInTheDocument();
    expect(button('Siguiente')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Saltar este paso' })).not.toBeInTheDocument();
  });

  it('el paso del modelo ofrece descargarlo y deja seguir cuando ya está', async () => {
    setup({ permission: 'notRequired', model: 'missing' });
    await act(async () => {});
    await next('Empezar');

    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
    expect(button('Siguiente')).toBeDisabled();

    act(() => useModelStore.setState({ status: model('ready') }));
    expect(button('Siguiente')).toBeEnabled();
  });

  it('el paso de la IA espera a que haya una IA en uso', async () => {
    setup({ permission: 'notRequired', model: 'ready', active: null });
    await act(async () => {});
    await next('Empezar');
    await next();

    expect(screen.getByRole('heading', { name: 'Tu IA' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Gemini' })).toBeInTheDocument();
    expect(button('Siguiente')).toBeDisabled();

    act(() => useAiStore.setState({ status: aiStatus('groq') }));
    expect(button('Siguiente')).toBeEnabled();
  });

  it('el último paso muestra los atajos y Terminar guarda que la guía ya se vio', async () => {
    setup({ permission: 'notRequired', model: 'ready', active: 'groq' });
    await act(async () => {});
    await next('Empezar');
    await next();
    await next();

    expect(screen.getByRole('heading', { name: 'Todo listo' })).toBeInTheDocument();
    expect(screen.getAllByText('Shift')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Saltar la guía' })).not.toBeInTheDocument();

    await next('Terminar');

    expect(mocked.setOnboardingDone).toHaveBeenCalledWith(true);
    expect(useGuideStore.getState().visible).toBe(false);
    expect(useSettingsStore.getState().onboardingDone).toBe(true);
  });

  it('Saltar la guía la cierra y recuerda que ya se vio', async () => {
    setup();
    await act(async () => {});
    await next('Saltar la guía');
    expect(mocked.setOnboardingDone).toHaveBeenCalledWith(true);
    expect(useGuideStore.getState().visible).toBe(false);
  });

  it('Atrás vuelve al paso anterior', async () => {
    setup({ permission: 'granted' });
    await act(async () => {});
    await next('Empezar');
    await next('Atrás');
    expect(screen.getByRole('heading', { name: 'Bienvenido a Orbit' })).toBeInTheDocument();
  });

  it('marca el paso actual y los pasos ya hechos en la fila de pasos', async () => {
    setup({ permission: 'granted' });
    await act(async () => {});
    await next('Empezar');
    const steps = screen.getByRole('list', { name: 'Pasos de la guía' });
    const items = steps.querySelectorAll('li');
    expect(items).toHaveLength(5);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('en inglés los textos salen en inglés', async () => {
    useLocaleStore.setState({ locale: 'en' });
    setup();
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Welcome to Orbit' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(button('Skip the guide')).toBeInTheDocument();
  });

  it('los pasos de adelante no se ven hechos solo porque la bienvenida o el final no necesitan nada', async () => {
    setup({ permission: 'notRequired', model: 'missing', active: null });
    await act(async () => {});
    const items = screen.getByRole('list', { name: 'Pasos de la guía' }).querySelectorAll('li');
    // Ninguno lleva palomita todavía: la guía recién empieza y nada de lo medible está hecho.
    expect(items[3]?.querySelector('svg')).toBeNull();

    // El modelo ya descargado sí se ve hecho aunque todavía no se llegue a ese paso.
    act(() => useModelStore.setState({ status: model('ready') }));
    expect(items[1]?.querySelector('svg')).not.toBeNull();
  });

  it('un paso que se saltó sin cumplirlo no se ve como hecho', async () => {
    setup({ permission: 'notRequired', model: 'ready', active: null });
    await act(async () => {});
    await next('Empezar');
    await next();
    await next('Saltar este paso');

    const items = screen.getByRole('list', { name: 'Pasos de la guía' }).querySelectorAll('li');
    expect(items[0]?.querySelector('svg')).not.toBeNull(); // bienvenida: ya se pasó
    expect(items[1]?.querySelector('svg')).not.toBeNull(); // modelo: descargado
    expect(items[2]?.querySelector('svg')).toBeNull(); // IA: saltada, sin cumplir
  });
});
