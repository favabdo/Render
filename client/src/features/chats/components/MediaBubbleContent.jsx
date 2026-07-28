import { useTranslation } from 'react-i18next';
import { FileWarning, Loader2, FileText } from 'lucide-react';
import { docKindLabel } from '../utils/mappers';

export default function MediaBubbleContent({ m, onOpenLightbox }) {
  const { t } = useTranslation('chats');
  if (!m.mediaUrl) {
    // الرسالة الواردة بتوصل وتتسجل فورًا من غير ما تستنى تنزيل الملف من واتساب
    // (شوف conversation.service.js) — لحد ما التنزيل يخلص في الخلفية، بنعرض
    // حالة "بيتم التحميل" مش "Media unavailable" لأن دي مش حالة فشل غالبًا،
    // مجرد ثواني قليلة استنى فيها التنزيل. لو فضلت أكتر من دقيقة فعلًا يبقى فشل.
    return (
      <>
        <div className="msg-media-unavailable">
          {m.from === 'customer' ? (
            <><Loader2 size={14} className="msg-media-spinner" /> {t('mediaBubble.loadingMedia')}</>
          ) : (
            <><FileWarning size={14} /> {t('mediaBubble.unavailable')}</>
          )}
        </div>
        {m.text && <div className="msg-media-caption">{m.text}</div>}
        <div className="msg-time" style={{ padding: '0 8px 6px' }}>{m.time}</div>
      </>
    );
  }

  let body;
  if (m.type === 'image' || m.type === 'sticker') {
    body = <img className="msg-media-image" src={m.mediaUrl} alt="image" onClick={() => onOpenLightbox(m.mediaUrl)} />;
  } else if (m.type === 'video') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    body = <video className="msg-media-video" src={m.mediaUrl} controls preload="metadata" />;
  } else if (m.type === 'audio') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    body = <audio className="msg-media-audio" src={m.mediaUrl} controls preload="metadata" />;
  } else {
    const kind = docKindLabel(m.mediaMime, m.fileName);
    body = (
      <a className="msg-media-doc" href={m.mediaUrl} target="_blank" rel="noopener noreferrer">
        <div className="msg-media-doc-icon"><FileText size={18} /></div>
        <div className="msg-media-doc-info">
          <span className="msg-media-doc-name">{m.fileName || kind}</span>
          <span className="msg-media-doc-hint">{kind} — {t('mediaBubble.tapToOpen')}</span>
        </div>
      </a>
    );
  }

  return (
    <>
      {body}
      {m._pending && <div className="msg-upload-progress">{m.failed ? t('mediaBubble.failed') : t('mediaBubble.sending')}</div>}
      {m.text && <div className="msg-media-caption">{m.text}</div>}
      <div className="msg-time" style={{ padding: '0 8px 6px' }}>{m.time}</div>
    </>
  );
}
