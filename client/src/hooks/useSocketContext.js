import { useContext } from 'react';
import { SocketContext } from './SocketContext';

export function useSocketContext() {
  return useContext(SocketContext);
}
