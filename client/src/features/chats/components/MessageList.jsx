import { useEffect, useRef, useState } from 'react';
import { dayKeyFor, dayDividerLabel } from '../utils/mappers';
import MessageBubble from './MessageBubble';
import MediaLightbox from './MediaLightbox';

export default function MessageList({ conversation, searchQuery, onRetryMessage, onCancelMessage }) {
  const containerRef = useRef(null);
  const prevConvId = useRef(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    prevConvId.current = conversation.id;
  }, [conversation.id, conversation.messages]);

  const rows = [];
  let previousDayKey = null;
  conversation.messages.forEach((m) => {
    const dayKey = dayKeyFor(m.rawTime);
    if (dayKey !== previousDayKey) {
      previousDayKey = dayKey;
      rows.push(
        <div className="msg-date-divider" key={`divider-${dayKey}`}>
          <span>{dayDividerLabel(m.rawTime)}</span>
        </div>
      );
    }
    rows.push(
      <MessageBubble
        key={m._clientId || m.id || `${m.from}-${m.rawTime}-${m.text}`}
        m={m}
        c={conversation}
        searchQuery={searchQuery}
        onOpenLightbox={setLightboxUrl}
        onRetry={onRetryMessage}
        onCancel={onCancelMessage}
      />
    );
  });

  return (
    <div className="chat-bg" id="chat-messages" ref={containerRef}>
      {rows}
      <MediaLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  );
}
