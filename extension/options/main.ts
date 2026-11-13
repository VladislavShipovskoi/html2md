import { initializeOptions } from './options.ts';
import { createRuntimeServices } from '../shared/runtime.ts';

export const startOptions = () => initializeOptions(createRuntimeServices(globalThis));
