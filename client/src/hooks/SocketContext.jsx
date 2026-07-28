import { createContext } from 'react';

export const SocketContext = createContext({ socketRef: { current: null }, connected: false });

export function SocketProvider({ value, children }) {
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
