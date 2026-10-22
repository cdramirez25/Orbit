/** Estado de la cámara de la tarjeta Cámara. */
export type CameraStatus = 'off' | 'starting' | 'on' | 'error';

/** Por qué no se pudo encender la cámara. */
export type CameraErrorKind = 'denied' | 'notFound' | 'busy' | 'unavailable' | 'unknown';
