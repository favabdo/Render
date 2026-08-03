import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Mic, Square, Send, Lock, Sparkles, Loader2, X, FileText, AtSign } from 'lucide-react';
import useToastStore from '../../../store/toastStore';
import { conversationsApi } from '../services/chats.service';
import Avatar from '../../../components/ui/Avatar';

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ACCEPT_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip';

function detectPreviewKind(mimeType) {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

function autoResize(el) {
  el.style.height = 'auto';
  const maxH = Math.min(window.innerHeight * 0.35, 160);
  el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
}
function isMobileLayout() {
  return window.matchMedia('(max-width:860px)').matches;
}

// بيدور من مكان الكيرسور للخلف عن أقرب @ بتبدأ كلمة (أول النص أو بعد مسافة/سطر
// جديد) — لو لقاها ومفيش مسافة بينها وبين الكيرسور، يبقى اليوزر بيكتب منشن
// دلوقتي فعلًا، وبيرجع النص اللي بعد الـ @ عشان نفلتر بيه قايمة الإيجنتس
function detectMentionQuery(value, cursorPos) {
  const upToCursor = value.slice(0, cursorPos);
  const atIndex = upToCursor.lastIndexOf('@');
  if (atIndex === -1) return null;
  const charBefore = atIndex > 0 ? upToCursor[atIndex - 1] : '';
  if (charBefore && !/\s/.test(charBefore)) return null;
  const query = upToCursor.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { query, start: atIndex, end: cursorPos };
}

function pickVoiceMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export default function MessageInput({
  conversationId,
  resolved,
  noteMode,
  onToggleNoteMode,
  onSend,
  onSendFile,
  onTypingChange,
  cannedResponses,
  typingNames = [],
  agents = [],
}) {
  const { t } = useTranslation('chats');
  const [text, setText] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const showToast = useToastStore((s) => s.showToast);

  // معاينة الملف/الصورة قبل الإرسال — الملف بيتحط هنا أول ما يتختار (من input
  // الملفات أو Paste)، وميتبعتش فعليًا (onSendFile) إلا لما اليوزر يضغط إرسال
  // أو Enter صراحة، بالظبط زي الرسايل النصية. قبل كده كان بيتبعت فورًا لحظة
  // الاختيار من غير أي فرصة للمراجعة أو الإلغاء.
  const [pendingFile, setPendingFile] = useState(null); // { file, previewUrl, kind }
  const [pendingCaption, setPendingCaption] = useState('');
  const captionRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    };
  }, [pendingFile]);

  const [generating, setGenerating] = useState(false);

  // منشن @اسم-إيجنت — mentionState فيها { query, start, end } لو اليوزر بيكتب
  // منشن دلوقتي، ومفيش (null) لو لأ. mentionIndex بيتتبع العنصر المتظلل حاليًا
  // في القايمة عشان يقدر يتنقل فيها بالسهام
  const [mentionState, setMentionState] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const filteredMentionAgents = mentionState
    ? agents
        .filter((a) => (a.display_name || a.email || '').toLowerCase().includes(mentionState.query.toLowerCase()))
        .slice(0, 6)
    : [];

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  function handleChange(e) {
    const value = e.target.value;
    setText(value);
    autoResize(e.target);
    onTypingChange(value.trim().length > 0);
    const mention = detectMentionQuery(value, e.target.selectionStart);
    setMentionState(mention);
    setMentionIndex(0);
  }

  function selectMention(agent) {
    if (!mentionState) return;
    const name = agent.display_name || agent.email;
    const before = text.slice(0, mentionState.start);
    const after = text.slice(mentionState.end);
    const newText = `${before}@${name} ${after}`;
    setText(newText);
    setMentionState(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = before.length + name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
      autoResize(el);
    });
  }

  function handleKeyDown(e) {
    if (mentionState && filteredMentionAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentionAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentionAgents.length) % filteredMentionAgents.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredMentionAgents[mentionIndex] || filteredMentionAgents[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileLayout()) return;
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    setMentionState(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function insertReply(reply) {
    setText(reply.text);
    textareaRef.current?.focus();
    if (textareaRef.current) autoResize(textareaRef.current);
  }

  function openFilePreview(file) {
    const kind = detectPreviewKind(file.type);
    const previewUrl = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null;
    setPendingFile({ file, previewUrl, kind });
    setPendingCaption('');
    setTimeout(() => captionRef.current?.focus(), 0);
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      showToast(t('messageInput.fileTooLarge'), 'error');
      return;
    }
    openFilePreview(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items || !items.length) return;
    const imageItem = Array.from(items).find((item) => item.kind === 'file' && item.type?.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      showToast(t('messageInput.imageTooLarge'), 'error');
      return;
    }
    openFilePreview(file);
  }

  function cancelPendingFile() {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    setPendingCaption('');
  }

  function confirmPendingFile() {
    if (!pendingFile) return;
    onSendFile(pendingFile.file, pendingCaption.trim());
    // previewUrl الأصلي مبقاش لازم بعد كده — onSendFile بيبني localUrl بتاعه هو
    // من الملف مباشرة للـ optimistic bubble (شوف handleSendFile في ChatMainPanel)
    if (pendingFile.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    setPendingCaption('');
  }

  function handleCaptionKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isMobileLayout()) return;
      e.preventDefault();
      confirmPendingFile();
    } else if (e.key === 'Escape') {
      cancelPendingFile();
    }
  }

  async function generateReply() {
    if (!conversationId || generating) return;
    setGenerating(true);
    try {
      const res = await conversationsApi.generateReply(conversationId);
      if (res.status === 204 || !res.data?.reply) return;
      setText(res.data.reply);
      textareaRef.current?.focus();
      if (textareaRef.current) autoResize(textareaRef.current);
    } catch (err) {
      console.error('[API] generateAIReply error:', err);
      showToast(err.response?.data?.error || t('messageInput.aiGenerateFailed'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  function updateTimer() {
    if (!startedAtRef.current) return;
    setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast(t('messageInput.recordingNotSupported'), 'error');
      return;
    }
    if (!conversationId) {
      showToast(t('messageInput.openConversationFirst'), 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast(t('messageInput.micAccessFailed'), 'error');
      return;
    }

    const mimeType = pickVoiceMimeType();
    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecording(false);
      setRecordSeconds(0);

      if (!cancelledRef.current && chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type });
        onSendFile(file);
      }
      chunksRef.current = [];
      recorderRef.current = null;
    };

    recorder.start();
    startedAtRef.current = Date.now();
    setRecording(true);
    setRecordSeconds(0);
    timerRef.current = setInterval(updateTimer, 250);
  }

  function toggleVoice() {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      cancelledRef.current = false;
      recorderRef.current.stop();
      return;
    }
    startVoiceRecording();
  }

  function cancelVoiceRecording() {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      cancelledRef.current = true;
      recorderRef.current.stop();
    }
  }

  const timeLabel = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`;

  return (
    <>
      {resolved && (
        <div className="resolved-banner show">
          <Lock size={14} />
          <span>{t('messageInput.resolvedBanner')}</span>
        </div>
      )}
      <div className={`typing-indicator-bar${!resolved && typingNames.length > 0 ? ' show' : ''}`}>
        <div className="typing-indicator-pill">
          <span className="typing-indicator-dots">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>
            {typingNames.length === 1
              ? t('header.typingOne', { name: typingNames[0] })
              : t('header.typingMany', { names: typingNames.join(', ') })}
          </span>
        </div>
      </div>
      {!resolved && cannedResponses.length > 0 && (
        <div className="saved-replies-bar">
          <span className="sr-label">{t('messageInput.quickReplies')}</span>
          {cannedResponses.map((r) => (
            <button key={r.id} className="sr-chip" onClick={() => insertReply(r)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {!resolved && (
        <div className="note-toggle-bar">
          <button
            className={`note-toggle-btn${noteMode ? ' active' : ''}`}
            title={t('messageInput.privateNoteTitle')}
            aria-label={t('messageInput.privateNoteTitle')}
            onClick={onToggleNoteMode}
          >
            <Lock size={13} /> {t('messageInput.privateNote')}
          </button>
          <button
            className={`note-toggle-btn${generating ? ' loading' : ''}`}
            title={t('messageInput.aiSuggestTitle')}
            aria-label={t('messageInput.aiSuggestTitle')}
            onClick={generateReply}
          >
            {generating ? <Loader2 size={13} className="ai-spin" /> : <Sparkles size={13} />} {t('messageInput.generateReply')}
          </button>
        </div>
      )}
      <div className={`chat-input-area${noteMode ? ' note-mode' : ''}${resolved ? ' resolved-locked' : ''}`} id="chat-input-area">
        {mentionState && filteredMentionAgents.length > 0 && (
          <div className="mention-dropdown">
            {filteredMentionAgents.map((a, i) => (
              <button
                key={a.id}
                type="button"
                className={`mention-option${i === mentionIndex ? ' active' : ''}`}
                // onMouseDown مش onClick — لازم يتنفذ قبل ما الـ textarea يعمل blur
                // (اللي بيحصل تلقائي أول ما تدوس بره الـ input) عشان الاختيار
                // ينفذ صح قبل ما الدروب داون يتقفل من onBlur
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(a);
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <Avatar name={a.display_name || a.email} seed={a.id} size={24} imageSrc={a.avatar_url || null} />
                <span>{a.display_name || a.email}</span>
              </button>
            ))}
          </div>
        )}
        {pendingFile ? (
          <div className="media-preview-bar">
            <button className="media-preview-cancel" title={t('messageInput.cancel')} aria-label={t('messageInput.cancel')} onClick={cancelPendingFile}>
              <X size={18} />
            </button>
            <div className="media-preview-thumb">
              {pendingFile.kind === 'image' && <img src={pendingFile.previewUrl} alt="" />}
              {pendingFile.kind === 'video' && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={pendingFile.previewUrl} muted />
              )}
              {pendingFile.kind === 'document' && (
                <div className="media-preview-doc-icon">
                  <FileText size={22} />
                </div>
              )}
            </div>
            <div className="media-preview-info">
              {pendingFile.kind === 'document' && <span className="media-preview-filename">{pendingFile.file.name}</span>}
              <input
                ref={captionRef}
                type="text"
                className="media-preview-caption"
                placeholder={t('messageInput.captionPlaceholder')}
                value={pendingCaption}
                onChange={(e) => setPendingCaption(e.target.value)}
                onKeyDown={handleCaptionKeyDown}
              />
            </div>
            <button className="send-btn" title={t('messageInput.send')} aria-label={t('messageInput.send')} onClick={confirmPendingFile}>
              <Send size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className="input-actions">
              <button
                className="input-action-btn"
                title={t('messageInput.attach')}
                aria-label={t('messageInput.attach')}
                style={{ visibility: recording ? 'hidden' : 'visible' }}
                onClick={() => fileInputRef.current?.click()}
                disabled={resolved}
              >
                <Paperclip size={20} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept={noteMode ? 'image/*' : ACCEPT_TYPES}
                onChange={handleFileChosen}
                disabled={resolved}
              />
            </div>

            {!recording && (
              <textarea
                id="msg-input"
                ref={textareaRef}
                rows={1}
                placeholder={resolved ? t('messageInput.closedPlaceholder') : noteMode ? t('messageInput.privateNote') : t('messageInput.typeMessage')}
                value={text}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={() => setMentionState(null)}
                disabled={resolved}
              />
            )}

            <div className={`voice-recording-bar${recording ? ' active' : ''}`}>
              <span className="voice-recording-dot"></span>
              <span className="voice-recording-time">{timeLabel}</span>
              <span className="voice-recording-hint">{t('messageInput.recordingHint')}</span>
              <button className="voice-cancel-btn" onClick={cancelVoiceRecording}>{t('messageInput.cancel')}</button>
            </div>

            <button
              className={`input-action-btn${recording ? ' recording' : ''}`}
              title={recording ? t('messageInput.stopAndSend') : t('messageInput.voiceNote')}
              aria-label={recording ? t('messageInput.stopAndSend') : t('messageInput.voiceNote')}
              onClick={toggleVoice}
              disabled={resolved}
            >
              {recording ? <Square size={16} /> : <Mic size={20} />}
            </button>
            <button
              className="send-btn"
              title={t('messageInput.send')}
              aria-label={t('messageInput.send')}
              style={{ display: recording ? 'none' : 'flex' }}
              onClick={submit}
              disabled={resolved}
            >
              <Send size={18} />
            </button>
          </>
        )}
      </div>
    </>
  );
}
