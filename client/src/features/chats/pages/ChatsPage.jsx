import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useChatsStore from '../store/chatsStore';
import { conversationsApi } from '../services/chats.service';
import { mapApiConversation, mapApiMessage, mediaKindLabel } from '../utils/mappers';
import { formatMessageTimestamp } from '../../../utils/dateFormat';
import { useSocketContext } from '../../../hooks/useSocketContext';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import ChatListPanel from '../components/ChatListPanel';
import ChatMainPanel from '../components/ChatMainPanel';

export default function ChatsPage() {
  const { t } = useTranslation('chats');
  const { user } = useAuthStore();
  const currentAgentName = user?.display_name || user?.email;
  const showToast = useToastStore((s) => s.showToast);
  const { socketRef, connected } = useSocketContext();

  const store = useChatsStore();
  const { conversations, selectedChatId, loaded } = store;
  const pollTimerRef = useRef(null);
  // آخر conversationId إحنا فعلاً منضمين لغرفته (join_conversation) — بنستخدمه
  // بس عشان نعرف نعمل rejoin بعد إعادة الاتصال (الغرف بتتصفّر مع أي انقطاع)
  const joinedConversationIdRef = useRef(null);

  useEffect(() => {
    store.loadConversations().catch(() => showToast(t('toasts.connectionError'), 'error'));
    store.loadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling fallback: بيشتغل بس لما الـ socket يبقى مقطوع (شبكة أمان مبسطة —
  // إعادة تحميل القايمة كاملة مع الحفاظ على الرسايل والليبلز/التيمز المحملة فعلاً
  // للمحادثة المفتوحة، بدل ما نعمل merge يدوي حقل حقل زي الأصل)
  useEffect(() => {
    async function pollSilently() {
      try {
        const rows = await conversationsApi.list();
        const mapped = rows.map(mapApiConversation);
        useChatsStore.setState((s) => ({
          conversations: mapped.map((m) => {
            const prev = s.conversations.find((x) => x.id === m.id);
            return prev
              ? { ...m, messages: prev.messages, _messagesLoaded: prev._messagesLoaded, labels: prev.labels, teams: prev.teams }
              : m;
          }),
        }));
      } catch (err) {
        console.error('[Poll] pollConversationsSilently error:', err);
      }
    }

    if (!connected) {
      if (!pollTimerRef.current) {
        console.warn('[Poll] الـ socket مش متصل — تفعيل شبكة الأمان (polling) مؤقتًا');
        pollTimerRef.current = setInterval(pollSilently, 3000);
      }
    } else if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [connected]);

  // Socket.IO Conversation Rooms: لما selectedChatId يتغيّر بنجهّز الـ cleanup
  // القديم الأول (بيبعت leave_conversation للمحادثة اللي كانت مفتوحة) قبل ما
  // React ينفّذ نسخة الـ effect الجديدة (بتبعت join_conversation للجديدة لو
  // فيه واحدة مفتوحة). React بيضمن ترتيب "cleanup القديم قبل الجديد" ده تلقائيًا،
  // فده بيحقق "leave المحادثة القديمة قبل join الجديدة" بالظبط. لو مفيش محادثة
  // مفتوحة (selectedChatId=null) منضمش لأي غرفة. نفس الـ cleanup بيشتغل عند
  // الخروج من صفحة الشاتس (unmount) عشان نسيب أي غرفة لسه منضمين فيها.
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket || selectedChatId == null) return undefined;

    socket.emit('join_conversation', selectedChatId);
    joinedConversationIdRef.current = selectedChatId;

    return () => {
      socket.emit('leave_conversation', selectedChatId);
      if (joinedConversationIdRef.current === selectedChatId) {
        joinedConversationIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId, socketRef?.current]);

  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;

    // new_message بقى room-scoped من السيرفر (بيوصل بس لو المحادثة دي فاتحة
    // فعلاً/منضمين لغرفتها) — فمسؤوليته بقت بس إضافة/تحديث الرسالة في الشات
    // المفتوح. تحديث كارت القايمة (lastMsg preview + unread) بقى مسؤولية
    // conversation_updated الخفيف اللي بيوصل global (شوف onConversationUpdated)
    function onNewMessage({ conversationId, message }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c) return;
      if (message.direction === 'system') {
        state.addMessage(c.id, {
          from: 'system',
          text: message.message_text || '',
          time: formatMessageTimestamp(message.created_at),
          rawTime: message.created_at,
        });
        return;
      }
      if (message.direction === 'out') {
        // ملاحظة: كل رسالة optimistic (نص أو ميديا) بقى ليها _clientId محلي دايمًا
        // (مستخدم في الـ Retry) — لكن السيرفر بيرجّع client_id بس لرسايل الميديا،
        // فمينفعش نشترط "!m._clientId" هنا وإلا الرسايل النصية هتفشل تتطابق
        // وهتتضاف تاني كرسالة جديدة (تكرار) بدل ما تستبدل نفس الفقاعة
        const pending = message.client_id
          ? c.messages.find((m) => m._pending && m._clientId === message.client_id)
          : c.messages.find((m) => m._pending && m.text === message.message_text);
        if (pending) {
          state.replaceMessage(
            c.id,
            (m) => m === pending,
            (m) => ({
              ...m,
              _pending: false,
              id: message.id || null,
              mediaUrl: message.media_url || m.mediaUrl,
              mediaMime: message.media_mime || m.mediaMime,
              fileName: message.media_filename || m.fileName,
            })
          );
          return;
        }
      }
      state.addMessage(c.id, {
        id: message.id || null,
        from: message.direction === 'out' ? 'agent' : 'customer',
        text: message.message_text || '',
        time: formatMessageTimestamp(message.created_at),
        rawTime: message.created_at,
        senderName: message.sent_by_name || null,
        phone: message.from_number || null,
        type: message.message_type && message.message_type !== 'text' ? message.message_type : null,
        mediaUrl: message.media_url || null,
        mediaMime: message.media_mime || null,
        fileName: message.media_filename || null,
      });
    }

    // الرسالة الواردة (صورة/فيديو/صوت/مستند) بتظهر فورًا من غير صورة (mediaUrl=null)
    // في onNewMessage، وبمجرد ما التنزيل من واتساب يخلص في الخلفية الحدث ده بيوصل
    // فيملي الصورة الفعلية في نفس الفقاعة من غير ما الإيجنت يعمل ريفريش
    function onMessageMediaReady({ conversationId, message }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c) return;
      state.replaceMessage(
        c.id,
        (m) => String(m.id) === String(message.id),
        (m) => ({
          ...m,
          mediaUrl: message.media_url || m.mediaUrl,
          mediaMime: message.media_mime || m.mediaMime,
        })
      );
    }

    function onNewNote({ conversationId, note }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c) {
        state.loadConversations();
        return;
      }
      const pending = c.messages.find((m) => m.isNote && m._pending && m.text === note.message_text);
      if (pending) {
        state.replaceMessage(
          c.id,
          (m) => m === pending,
          (m) => ({ ...m, _pending: false })
        );
        return;
      }
      state.addMessage(c.id, {
        from: 'note',
        text: note.message_text || '',
        time: formatMessageTimestamp(note.created_at),
        rawTime: note.created_at,
        senderName: note.sent_by_name || null,
        isNote: true,
      });
    }

    function onMessageFailed({ conversationId, text }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c) return;
      state.replaceMessage(
        c.id,
        (m) => m._pending && m.text === text,
        (m) => ({ ...m, _pending: false, failed: true })
      );
      showToast(t('toasts.sendFailed'), 'error');
    }

    function onNoteFailed({ conversationId, text }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c) return;
      state.replaceMessage(
        c.id,
        (m) => m.isNote && m._pending && m.text === text,
        (m) => ({ ...m, _pending: false, failed: true })
      );
      showToast(t('toasts.noteSaveFailed'), 'error');
    }

    function onTyping({ conversationId, agentName } = {}) {
      if (!conversationId || !agentName) return;
      useChatsStore.getState().setAgentTyping(conversationId, agentName, true);
      setTimeout(() => useChatsStore.getState().setAgentTyping(conversationId, agentName, false), 4000);
    }
    function onStopTyping({ conversationId, agentName } = {}) {
      if (!conversationId || !agentName) return;
      useChatsStore.getState().setAgentTyping(conversationId, agentName, false);
    }

    // conversation_updated بقى الحدث الـ global المسؤول عن تحديث كارت
    // المحادثة في القايمة الجانبية — بيوصل بشكلين: (1) الصف الكامل من
    // الداتابيز لما status/assigned_agent يتغيّروا (زي الأول تمامًا)، أو (2)
    // ملخص خفيف (lastMessageText/Type/Direction/At بس) لما رسالة جديدة توصل/
    // تتبعت، عشان نحدّث معاينة آخر رسالة وعداد unread حتى لو المحادثة دي مش
    // مفتوحة دلوقتي (new_message بقى بيوصل بس لمين فاتحها فعليًا)
    function onConversationUpdated(updatedConv) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(updatedConv.id));
      if (!c) {
        state.loadConversations();
        if (updatedConv.lastMessageDirection === 'in') {
          showToast(t('toasts.newMessageFromCustomer'), 'info');
        }
        return;
      }
      const patch = {};
      if (updatedConv.status !== undefined) {
        patch.status = updatedConv.status === 'closed' ? 'resolved' : 'open';
        patch.rawStatus = updatedConv.status;
      }
      if (updatedConv.assigned_agent_name !== undefined) {
        patch.assignedTo = updatedConv.assigned_agent_name || c.assignedTo;
      }
      if (updatedConv.lastMessageText !== undefined) {
        patch.lastMsg =
          updatedConv.lastMessageText ||
          (updatedConv.lastMessageType && updatedConv.lastMessageType !== 'text' ? mediaKindLabel(updatedConv.lastMessageType) : '');
      }
      if (updatedConv.lastMessageDirection === 'in' && state.selectedChatId !== c.id) {
        patch.unread = (c.unread || 0) + 1;
      }
      state.patchConversation(c.id, patch);
    }

    function onLabelsUpdated(labels) {
      useChatsStore.setState({ allLabels: labels || [] });
    }
    function onTeamsUpdated(teams) {
      useChatsStore.setState({ teams: teams || [] });
    }
    function onConvLabelsUpdated({ conversationId, labels } = {}) {
      if (!conversationId) return;
      useChatsStore.getState().patchConversation(Number(conversationId), { labels: labels || [] });
    }
    function onConvTeamsUpdated({ conversationId, teams } = {}) {
      if (!conversationId) return;
      useChatsStore.getState().patchConversation(Number(conversationId), { teams: teams || [] });
    }
    function onAgentStatusChanged({ userId } = {}) {
      if (!user || String(userId) !== String(user.id)) return;
      showToast(t('toasts.accountDisabled'), 'error');
      setTimeout(() => useAuthStore.getState().logout(), 1200);
    }

    async function onReconnectResync() {
      try {
        const rows = await conversationsApi.list();
        const mapped = rows.map(mapApiConversation);
        useChatsStore.setState((s) => ({
          conversations: mapped.map((m) => {
            const prev = s.conversations.find((x) => x.id === m.id);
            return prev
              ? { ...m, messages: prev.messages, _messagesLoaded: prev._messagesLoaded, labels: prev.labels, teams: prev.teams }
              : m;
          }),
        }));
        const openId = useChatsStore.getState().selectedChatId;
        if (openId) {
          // إعادة الانضمام لغرفة المحادثة المفتوحة بعد إعادة الاتصال — الاتصال
          // الجديد بيبدأ من غير غرف (الغرف القديمة بتتمسح مع انقطاع الاتصال)
          socket.emit('join_conversation', openId);
          joinedConversationIdRef.current = openId;
          const data = await conversationsApi.messages(openId);
          const messages = data.messages
            .filter((m) => ['in', 'out', 'note', 'system'].includes(m.direction))
            .map(mapApiMessage);
          useChatsStore.getState().patchConversation(openId, { messages, _messagesLoaded: true });
        }
      } catch (err) {
        console.error('[Reconnect] resync error:', err);
      }
    }

    socket.on('new_message', onNewMessage);
    socket.on('message_media_ready', onMessageMediaReady);
    socket.on('new_note', onNewNote);
    socket.on('message_failed', onMessageFailed);
    socket.on('note_failed', onNoteFailed);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    socket.on('conversation_updated', onConversationUpdated);
    socket.on('labels_updated', onLabelsUpdated);
    socket.on('teams_updated', onTeamsUpdated);
    socket.on('conversation_labels_updated', onConvLabelsUpdated);
    socket.on('conversation_teams_updated', onConvTeamsUpdated);
    socket.on('agent_status_changed', onAgentStatusChanged);
    socket.on('connect', onReconnectResync);

    return () => {
      socket.off('connect', onReconnectResync);
      socket.off('new_message', onNewMessage);
      socket.off('new_note', onNewNote);
      socket.off('message_media_ready', onMessageMediaReady);
      socket.off('message_failed', onMessageFailed);
      socket.off('note_failed', onNoteFailed);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
      socket.off('conversation_updated', onConversationUpdated);
      socket.off('labels_updated', onLabelsUpdated);
      socket.off('teams_updated', onTeamsUpdated);
      socket.off('conversation_labels_updated', onConvLabelsUpdated);
      socket.off('conversation_teams_updated', onConvTeamsUpdated);
      socket.off('agent_status_changed', onAgentStatusChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketRef?.current]);

  const selected = conversations.find((c) => c.id === selectedChatId) || null;

  if (!loaded) {
    return (
      <div id="page-chats" className="page">
        <div className="empty-chat" style={{ flex: 1 }}>
          <p>{t('loadingConversations')}</p>
        </div>
      </div>
    );
  }

  return (
    <div id="page-chats" className={`page${selected ? ' mobile-chat-open' : ''}`}>
      <ChatListPanel currentAgentName={currentAgentName} />
      <ChatMainPanel conversation={selected} currentAgentName={currentAgentName} socketRef={socketRef} />
    </div>
  );
}
