import { initializePopup } from './popup.ts';
import { createRuntimeServices } from '../shared/runtime.ts';

export const startPopup = () => initializePopup(createRuntimeServices(globalThis));
