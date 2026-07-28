import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// نفس فكرة initSocket() في dashboard.html: لو الاتصال فشل أو اتقطع، بننادي onDisconnected
// (اللي المفروض يشغّل polling fallback عند اللي بيستخدم الهوك) عشان الداشبورد يفضل شغال
// حتى من غير realtime. لو الاتصال رجع تاني، بننادي onConnected عشان نوقف الـ polling.
//
// التوكن بيتبعت في handshake.auth.token — السيرفر بيتحقق منه ولو صاحبه أدمن/أونر
// بيضمه لغرفة post_resolve_viewers (رسايل تقييم العميل CSAT اللايف). التوكن اختياري
// من ناحية السيرفر (لو مبعوتش أو غلط، الاتصال بيكمل عادي من غير الميزة دي).
export function useSocket({ onConnected, onDisconnected } = {}) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket;
    try {
      const token = localStorage.getItem('nilechat_token');
      socket = io('', { transports: ['websocket', 'polling'], auth: { token } });
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);
        onConnected?.();
      });
      socket.on('disconnect', () => {
        setConnected(false);
        onDisconnected?.();
      });
      socket.on('connect_error', (err) => {
        console.warn('[Socket.io] connect_error:', err.message);
        setConnected(false);
        onDisconnected?.();
      });
    } catch (err) {
      console.warn('[Socket.io] init failed — الداشبورد هيشتغل من غير realtime', err);
      onDisconnected?.();
    }

    return () => {
      socket?.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { socket: socketRef, connected };
}
