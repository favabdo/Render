import { useTranslation } from 'react-i18next';
import { Phone, User } from 'lucide-react';

export default function PrevConversationCard({ p, onClick }) {
  const { t } = useTranslation('chats');
  return (
    <div className="prev-conv-item" onClick={onClick}>
      <div className="prev-conv-top-row">
        <div className="prev-conv-date">{p.date}</div>
        {p.daysAgo && <div className="prev-conv-days-ago">{p.daysAgo}</div>}
      </div>
      {p.phone && (
        <div className="prev-conv-phone">
          <Phone size={11} /> {p.phone}
        </div>
      )}
      <div className="prev-conv-preview">{p.preview}</div>
      <div className="prev-conv-footer">
        <span className="prev-conv-count">{p.count} {t('prevConversation.messages')}</span>
        {p.handledBy && (
          <span className="prev-conv-agent">
            <User size={11} /> {p.handledBy}
          </span>
        )}
      </div>
    </div>
  );
}
