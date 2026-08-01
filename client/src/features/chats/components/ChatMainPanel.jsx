import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle } from 'lucide-react';
import useChatsStore from '../store/chatsStore';
import { formatMessageTimestamp } from '../../../utils/dateFormat';
import { conversationsApi } from '../services/chats.service';
import { mediaKindLabel } from '../utils/mappers';
import { compressImageIfNeeded } from '../utils/compressImage';
import useToastStore from '../../../store/toastStore';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import CustomerPanel from './CustomerPanel';
import ResolveModal from './ResolveModal';

function detectMediaKind(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}
function generateClientId() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

export default function ChatMainPanel({ conversation, currentAgentName, socketRef }) {
  const { t } = useTranslation('chats');
  const {
    customerPanelOpen,
    noteMode,
    typingAgents,
    toggleCustomerPanel,
    toggleNoteMode,
    patchConversation,
    addMessage,
    resolveCategories,
    cannedResponses,
    closeChat,
  } = useChatsStore();
  const showToast = useToastStore((s) => s.showToast);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [resolveOpen, setResolveOpen] = useState(false);

  if (!conversation) {
    return (
      <div id="chat-main-panel">
        <div id="empty-chat" className="empty-chat" style={{ flex: 1 }}>
          <div className="empty-chat-icon">
            <MessageCircle size={36} />
          </div>
          <h3>{t('mainPanel.emptyTitle')}</h3>
          <p>{t('mainPanel.emptySubtitle')}</p>
        </div>
      </div>
    );
  }

  const c = conversation;
  const typingNames = Array.from(typingAgents[String(c.id)] || []);

  // بنحسب عدد التطابقات بحساب الرسايل اللي فيها النص (تقريبي بديل عن querySelectorAll
  // الأصلي — بيدي نفس النتيجة العملية للتنقل بين النتائج)
  const matchCount = searchQuery
    ? c.messages.filter(
        (m) => m.from !== 'note' && m.from !== 'system' && m.text.toLowerCase().includes(searchQuery.toLowerCase())
      ).length
    : 0;

  // بنبعت النوت فعليًا (مستخدمة من handleSend الأول مرة وكمان من الـ Retry)
  async function sendNote(text, clientId) {
    try {
      await conversationsApi.addNote(c.id, text);
    } catch (err) {
      console.error('[API] sendNoteText error:', err);
      showToast(err.response?.data?.error || t('mainPanel.addNoteFailed'), 'error');
      useChatsStore.getState().replaceMessage(c.id, (m) => m._clientId === clientId, (m) => ({ ...m, _pending: false, failed: true }));
    }
  }

  // بنبعت رسالة نص فعليًا (مستخدمة من handleSend الأول مرة وكمان من الـ Retry) —
  // الـ socket ('new_message'/'message_failed') هو اللي بيأكد نجاح/فشل الإرسال
  // الفعلي على واتساب في الخلفية عن طريق مطابقة _clientId
  async function sendText(text, clientId) {
    try {
      await conversationsApi.reply(c.id, text);
    } catch (err) {
      console.error('[API] sendMessage error:', err);
      showToast(err.response?.data?.error || t('mainPanel.sendFailed'), 'error');
      useChatsStore.getState().replaceMessage(c.id, (m) => m._clientId === clientId, (m) => ({ ...m, _pending: false, failed: true }));
    }
  }

  async function handleSend(text) {
    const clientId = generateClientId();
    const nowIso = new Date().toISOString();

    if (noteMode) {
      addMessage(c.id, {
        from: 'note',
        text,
        time: formatMessageTimestamp(nowIso),
        rawTime: nowIso,
        senderName: currentAgentName,
        isNote: true,
        _pending: true,
        _clientId: clientId,
      });
      await sendNote(text, clientId);
      return;
    }

    if (c.rawStatus === 'closed') {
      showToast(t('mainPanel.conversationClosed'), 'error');
      return;
    }

    addMessage(c.id, {
      from: 'agent',
      text,
      time: formatMessageTimestamp(nowIso),
      rawTime: nowIso,
      senderName: currentAgentName,
      _pending: true,
      _clientId: clientId,
    });
    patchConversation(c.id, { lastMsg: text });
    await sendText(text, clientId);
  }

  // بديل sendMediaFile() الأصلي: نفس فلسفة handleSend (optimistic فورية + تأكيد لاحق
  // عن طريق الـ socket)، بس هنا بيتبعت ملف فعلي بـ FormData ومطابقة عن طريق client_id
  // بدل النص، عشان أكتر من ملف ممكن يتبعتوا بنفس اللحظة. بنحتفظ بالملف الأصلي
  // (_file) جوه الرسالة عشان الـ Retry يقدر يعيد الرفع من غير ما اليوزر يختار
  // الملف تاني
  async function sendMediaFile(file, clientId) {
    const kind = detectMediaKind(file.type);
    try {
      // بنصغّر الصورة قبل الرفع (لو محتاجة) — مبيأثرش على الـ preview اللي
      // ظهر فورًا فوق (localUrl) لأنه مبني على الملف الأصلي، بس اللي بيتبعت
      // فعليًا للسيرفر هو النسخة المصغّرة عشان الرفع يخلص أسرع بكتير
      const uploadFile = kind === 'image' ? await compressImageIfNeeded(file) : file;
      await conversationsApi.replyMedia(c.id, uploadFile, clientId);
      // زي sendMessage تمامًا: الـ socket هو اللي هيأكد الرسالة فعليًا (new_message)
      // أو يعلّمها فشلت (message_failed) لما الرفع لواتساب يخلص فعليًا في الخلفية
    } catch (err) {
      console.error('[API] sendMediaFile error:', err);
      showToast(err.response?.data?.error || t('mainPanel.uploadFailed'), 'error');
      useChatsStore.getState().replaceMessage(c.id, (m) => m._clientId === clientId, (m) => ({ ...m, _pending: false, failed: true }));
    }
  }

  async function handleSendFile(file) {
    if (c.rawStatus === 'closed') {
      showToast(t('mainPanel.conversationClosed'), 'error');
      return;
    }

    const clientId = generateClientId();
    const kind = detectMediaKind(file.type);
    const localUrl = URL.createObjectURL(file);
    const nowIso = new Date().toISOString();

    addMessage(c.id, {
      from: 'agent',
      text: '',
      time: formatMessageTimestamp(nowIso),
      rawTime: nowIso,
      senderName: currentAgentName,
      _pending: true,
      _clientId: clientId,
      _file: file,
      type: kind,
      mediaUrl: localUrl,
      mediaMime: file.type,
      fileName: file.name,
    });
    patchConversation(c.id, { lastMsg: mediaKindLabel(kind) });
    await sendMediaFile(file, clientId);
  }

  // إعادة محاولة رسالة/نوت/ملف فشل إرساله — بيرجّعها Pending تاني ويبعتها من
  // غير ما اليوزر يكتب أو يختار الملف تاني، وبيفضل ظاهر لحد ما ينجح أو يتلغي
  function handleRetry(m) {
    useChatsStore.getState().replaceMessage(c.id, (x) => x === m, (x) => ({ ...x, _pending: true, failed: false }));
    const clientId = m._clientId || generateClientId();
    if (m.isNote) {
      sendNote(m.text, clientId);
    } else if (m._file) {
      sendMediaFile(m._file, clientId);
    } else {
      sendText(m.text, clientId);
    }
  }

  // إلغاء رسالة فشلت — بتتشال من الشات فورًا (Optimistic)، ولو كانت رسالة نص/ميديا
  // حقيقية (مش نوت) اتسجلت في الداتابيز فعلاً وقت محاولة الإرسال (مرحلة 1)، بنبعت
  // طلب حذف فعلي للسيرفر برضه — عشان متفضلش ترجع تاني لو عملنا Refresh. النوت
  // مختلفة: لو فشلت يبقى معملتش INSERT في الداتابيز أصلاً، فمفيش حاجة نحذفها.
  function handleCancel(m) {
    useChatsStore.getState().removeMessage(c.id, (x) => x === m);
    if (!m.isNote && m.id) {
      conversationsApi.deleteMessage(c.id, m.id).catch(() => {
        // فشل الحذف نادر وغير قاتل — الرسالة اتشالت من واجهة الإيجنت خلاص،
        // ولو ظهرت تاني بعد Refresh هيقدر يلغيها تاني من غير أي مشكلة
      });
    }
  }

  function handleTypingChange(hasText) {
    const socket = socketRef?.current;
    if (!socket || noteMode) return;
    if (hasText) socket.emit('typing', { conversationId: c.id, agentName: currentAgentName });
    else socket.emit('stop_typing', { conversationId: c.id, agentName: currentAgentName });
  }

  function handleResolveClick() {
    if (c.status === 'resolved') {
      const previous = { status: c.status, rawStatus: c.rawStatus };
      // Optimistic: نفتح المحادثة في الواجهة فورًا، ونستنى تأكيد السيرفر في الخلفية
      patchConversation(c.id, { status: 'open', rawStatus: 'open' });
      conversationsApi
        .reopen(c.id)
        .then(() => showToast(t('mainPanel.reopenedSuccess'), 'success'))
        .catch((err) => {
          patchConversation(c.id, previous);
          showToast(err.response?.data?.error || t('mainPanel.reopenFailed'), 'error');
        });
    } else {
      setResolveOpen(true);
    }
  }

  return (
    <div id="chat-main-panel">
      <div id="chat-area" style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
        <ChatHeader
          conversation={c}
          onBack={closeChat}
          onToggleSearch={() => setSearchOpen((v) => !v)}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          onSearchChange={(v) => {
            setSearchQuery(v);
            setMatchIndex(0);
          }}
          matchCount={matchCount}
          matchIndex={matchIndex}
          onNextMatch={() => setMatchIndex((i) => (matchCount ? (i + 1) % matchCount : 0))}
          onPrevMatch={() => setMatchIndex((i) => (matchCount ? (i - 1 + matchCount) % matchCount : 0))}
          onResolveClick={handleResolveClick}
          onCustomerPanelToggle={toggleCustomerPanel}
        />
        <MessageList
          conversation={c}
          searchQuery={searchOpen ? searchQuery : ''}
          onRetryMessage={handleRetry}
          onCancelMessage={handleCancel}
        />
        <MessageInput
          conversationId={c.id}
          resolved={c.status === 'resolved'}
          noteMode={noteMode}
          onToggleNoteMode={toggleNoteMode}
          onSend={handleSend}
          onSendFile={handleSendFile}
          onTypingChange={handleTypingChange}
          cannedResponses={cannedResponses}
          typingNames={typingNames}
        />
      </div>

      {customerPanelOpen && <CustomerPanel conversation={c} currentAgentName={currentAgentName} onClose={toggleCustomerPanel} />}

      {resolveOpen && (
        <ResolveModal
          conversation={c}
          categories={resolveCategories}
          onClose={() => setResolveOpen(false)}
          onResolved={(catName, opts) => {
            if (opts?.rollback) {
              // فشل الـ resolve في الخلفية بعد ما كنا سكّرنا المحادثة optimistically —
              // بنرجّعها مفتوحة تاني (المودال نفسه كان اتقفل خلاص لما بدأنا)
              patchConversation(c.id, { status: 'open', rawStatus: 'open' });
              return;
            }
            patchConversation(c.id, { status: 'resolved', rawStatus: 'closed', resolveCategory: catName });
            setResolveOpen(false);
            closeChat();
          }}
        />
      )}
    </div>
  );
}
