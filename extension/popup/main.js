import { initializePopup } from './popup.js';
import { createRuntimeServices } from '../shared/runtime.js';

export const startPopup = () => initializePopup(createRuntimeServices(globalThis));
