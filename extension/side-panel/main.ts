import { initializeSidePanel } from './side-panel.ts';
import { createRuntimeServices } from '../shared/runtime.ts';

export const startSidePanel = () => initializeSidePanel(createRuntimeServices(globalThis));
