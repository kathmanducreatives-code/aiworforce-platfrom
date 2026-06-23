import { createContext, useContext, type ReactNode } from 'react';

const ChatPaneWidthContext = createContext<number>(Number.POSITIVE_INFINITY);

export function ChatPaneWidthProvider({ width, children }: { width: number; children: ReactNode }) {
  return <ChatPaneWidthContext.Provider value={width}>{children}</ChatPaneWidthContext.Provider>;
}

/** Returns the current chat pane width in px. `Infinity` when not inside a split. */
export function useChatPaneWidth() {
  return useContext(ChatPaneWidthContext);
}
