import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useChatsStore from '../store/chatsStore';
import { conversationsApi } from '../services/chats.service';
import { mapApiConversation, mapApiMessage, mediaKindLabel } from '../utils/mappers';
import { formatMessageTimestamp, formatTime } from '../../../utils/dateFormat';
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

    // لو رجعنا لتاب الشاتس وفيه محادثة كانت مفتوحة خلاص (من قبل ما نسيب
    // التاب)، لازم نعيد تحميل رسايلها فورًا بدل ما نعتمد على الكاش القديم.
    // السبب: الـ effect بتاع join_conversation تحت بتعمل "leave_conversation"
    // كـ cleanup أول ما الكومبوننت يتعمله unmount (يعني أول ما تسيب تاب
    // الشاتس لأي تاب تاني زي Contacts/Analytics)، فأي رسالة جديدة توصل وانت
    // برة معندهاش حد منضم لغرفتها (new_message room-scoped)، فمتوصلش. اللي
    // بيوصل بس هو conversation_updated (عالمي) اللي بيحدّث البريفيو في
    // القايمة الجانبية بس — مش محتوى المحادثة نفسها. وبما إن _messagesLoaded
    // بيفضل true للأبد أول ما يتحط، مفيش حاجة تانية كانت هتجبر إعادة التحميل
    // ده غير ريفريش يدوي كامل للصفحة
    const openId = useChatsStore.getState().selectedChatId;
    if (openId) {
      useChatsStore.getState().loadMessagesForConversation(openId, { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // بيغطي الحالة اللي join_conversation/leave_conversation effect (تحت)
  // مبيغطيهاش: انت لسه واقف جوه نفس صفحة الشاتس (مفيش unmount خالص)، بس
  // بدّلت تاب البراوزر، قفلت الشاشة، أو رحت تطبيق تاني شوية. الاتصال بالسوكيت
  // ممكن يفضل شغال طول الوقت (فمفيش reconnect يحصل يبقى onReconnectResync
  // ماينفعش)، أو ممكن يتقطع لفترة قصيرة برضو من غير ما تلاحظ. في الحالتين،
  // مش مضمون إننا استقبلنا كل الرسايل اللي وصلت وانت مش شايف الصفحة. عشان
  // كده أول ما الصفحة/التاب ترجع تبقى مرئية تاني، بنجبر: (1) تحديث قايمة
  // المحادثات كلها (بيشيل أي محادثة اتمسحت من الداتابيز في الفترة دي كمان)،
  // و(2) تحديث رسايل المحادثة المفتوحة تحديدًا من الصفر
  useEffect(() => {
    function refreshOnReturn() {
      if (document.visibilityState !== 'visible') return;
      useChatsStore.getState().loadConversations().catch(() => {});
      const openId = useChatsStore.getState().selectedChatId;
      if (openId) {
        useChatsStore.getState().loadMessagesForConversation(openId, { force: true });
      }
    }

    document.addEventListener('visibilitychange', refreshOnReturn);
    window.addEventListener('focus', refreshOnReturn);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnReturn);
      window.removeEventListener('focus', refreshOnReturn);
    };
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
            // بنحافظ على phones (فيها الاسم الثانوي) و_contactLoaded زي ما هما —
            // لو مسحناهم هيرجعوا للقيمة الافتراضية (رقم من غير ليبل) وده كان بيخلي
            // الاسم الثانوي يختفي من الكارت ومن فوق رسايل العميل مع كل poll
            return prev
              ? {
                  ...m,
                  messages: prev.messages,
                  _messagesLoaded: prev._messagesLoaded,
                  labels: prev.labels,
                  teams: prev.teams,
                  phones: prev._contactLoaded ? prev.phones : m.phones,
                  _contactLoaded: prev._contactLoaded,
                  // زي loadConversations بالظبط: مانمسحش unread عند أي poll خلفي —
                  // لازم يفضل زي ما هو لحد ما الإيجنت نفسه يفتح المحادثة
                  unread: prev.unread,
                }
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
  // ملاحظة مهمة: بنضيف "connected" في الـ deps هنا بالإضافة لـ socketRef?.current —
  // القراءة من socketRef?.current لوحدها مش كافية، لأن تغيير ref.current مش
  // بيسبب re-render (الـ refs مش reactive)، فلو الإيفكت ده اشتغل أول مرة قبل ما
  // الـ socket يتوصل فعليًا (لسه null) ممكن يفضل كده لحد أي re-render تاني يحصل
  // بالصدفة. وبعد أي انقطاع/إعادة اتصال (نوم اللابتوب، تبديل شبكة، تطبيق رجع من
  // الباكجراوند...) عضوية الغرفة القديمة (join_conversation) بتتمسح من السيرفر
  // مع الانقطاع من غير ما حد يعيد الانضمام تلقائيًا — وده كان بيسبب "لازم أعمل
  // ريفريش عشان أشوف رسالة العميل الجديدة" حتى لو واقف في نفس المحادثة فعليًا.
  // ضمان إن الإيفكت ده يعيد التنفيذ مع كل تغيير في "connected" (true بعد أي
  // reconnect) بيضمن إعادة الانضمام للغرفة فورًا في كل مرة.
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
  }, [selectedChatId, connected, socketRef?.current]);

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
              // بتظهر تيك واحد فورًا أول ما الرسالة توصل هنا (optimistic)، بغض
              // النظر عن الحالة الحقيقية من واتساب — الحالة الحقيقية (sent/
              // delivered/read) بتتحدّث بعدين عن طريق message_status_updated
              status: 'sent',
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
        status: message.direction === 'out' ? 'sent' : null,
      });
    }

    // تحديث حالة رسالة بعتناها (sent/delivered/read) أو فشلها بعد ما كانت
    // اتأكدت خالص — بيوصل من processStatusUpdates في السيرفر لما ميتا ترجع
    // حالة جديدة لرسالة بعتناها قبل كده. لو الحالة 'failed' بنستخدم نفس مسار
    // الفشل الموجود أصلاً (Retry/Cancel) بدل ما نعرض تيك.
    function onMessageStatusUpdated({ conversationId, message }) {
      const state = useChatsStore.getState();
      const c = state.conversations.find((x) => String(x.id) === String(conversationId));
      if (!c || message?.id == null) return;
      state.replaceMessage(
        c.id,
        (m) => String(m.id) === String(message.id),
        (m) =>
          message.status === 'failed'
            ? { ...m, failed: true }
            : { ...m, status: message.status }
      );
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
      // بيوصل بشكلين: (1) الصف الكامل من الداتابيز فيه last_message_at
      // (snake_case)، أو (2) الملخص الخفيف بتاع buildConversationSummary فيه
      // lastMessageAt (camelCase) — لازم نتعامل مع الاتنين عشان قايمة الشاتس
      // تعرف ترتب نفسها بأحدث محادثة فوق دايمًا (شوف sortConversationsByRecency)
      const rawLastMessageAt = updatedConv.lastMessageAt ?? updatedConv.last_message_at;
      if (rawLastMessageAt) {
        patch._lastMessageAtRaw = rawLastMessageAt;
        patch.time = formatTime(rawLastMessageAt);
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
            // بنحافظ على phones (فيها الاسم الثانوي اللي الإيجنت عدّله) و_contactLoaded
            // زي ما هما — لو مسحناهم هنا هيرجعوا للقيمة الافتراضية (رقم من غير ليبل)
            // وده كان بيخلي الاسم الثانوي يختفي من الكارت ومن فوق رسايل العميل بعد
            // أي إعادة اتصال للسوكيت (شبكة اتقطعت، التاب رجع من الباكجراوند، إلخ)
            return prev
              ? {
                  ...m,
                  messages: prev.messages,
                  _messagesLoaded: prev._messagesLoaded,
                  labels: prev.labels,
                  teams: prev.teams,
                  phones: prev._contactLoaded ? prev.phones : m.phones,
                  _contactLoaded: prev._contactLoaded,
                  unread: prev.unread,
                }
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
    socket.on('message_status_updated', onMessageStatusUpdated);
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
      socket.off('message_status_updated', onMessageStatusUpdated);
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
    // نفس سبب إضافة "connected" في إيفكت join_conversation فوق بالظبط — بدونها
    // ممكن الإيفكت ده ميعيدش تسجيل الليسنرز (زي new_message) على socket الاتصال
    // الجديد بعد أي reconnect إلا لو حصل re-render تاني بالصدفة لسبب مختلف
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketRef?.current, connected]);

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
