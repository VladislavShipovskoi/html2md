import { initializeOptions } from './options.js';
import { createRuntimeServices } from '../shared/runtime.js';

export const startOptions = () => initializeOptions(createRuntimeServices(globalThis));
