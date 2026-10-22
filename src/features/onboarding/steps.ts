export type StepId = 'welcome' | 'audio' | 'model' | 'ai' | 'done';

/** Los pasos de la guía. El del permiso de audio solo existe donde el sistema lo pide (macOS). */
export function guideSteps(audioPermissionNeeded: boolean): StepId[] {
  return audioPermissionNeeded
    ? ['welcome', 'audio', 'model', 'ai', 'done']
    : ['welcome', 'model', 'ai', 'done'];
}
