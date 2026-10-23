// Whether the person viewing the Company Brain may edit it (roadmap Phase 3a).
// Every in-place editor reads this, so a viewer's page has no editing controls
// at all. Guidance only: the server refuses a viewer's write regardless
// (_shared/brainRole.ts, and the browser cannot write the table).
import { createContext, useContext } from 'react';

export const BrainEditableContext = createContext(true);
export const useBrainEditable = () => useContext(BrainEditableContext);
