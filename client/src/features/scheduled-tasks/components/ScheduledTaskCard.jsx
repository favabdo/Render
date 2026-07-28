import { useTranslation } from 'react-i18next';
import { UserRoundSearch, UserRound, Clock, Calendar, CalendarCheck, Check, AlarmClock, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useChatsStore from '../../chats/store/chatsStore';
import useToastStore from '../../../store/toastStore';
import { formatSchedDate } from '../../../utils/dateFormat';

export default function ScheduledTaskCard({ t: task, ended, onEnd }) {
  const { t } = useTranslation('scheduledTasks');
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.showToast);
  const conversations = useChatsStore((s) => s.conversations);
  const selectChat = useChatsStore((s) => s.selectChat);
  const isLate = task.delivery_status === 'late';

  function goToTaskConversation() {
    const match = conversations.find((c) => String(c.contactId) === String(task.contact_id));
    if (!match) return showToast(t('card.conversationNotVisible'), 'info');
    navigate('/dashboard/chats');
    selectChat(match.id);
  }

  return (
    <div className={`sched-task-card${ended ? ' ended' : ''}${task._pending ? ' opt-pending' : ''}`}>
      <div className="sched-task-customer">
        <UserRoundSearch size={16} />
        <span
          onClick={goToTaskConversation}
          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
        >
          {task.customer_name || t('card.unknownCustomer')}
        </span>
      </div>
      <div className="sched-task-subrow">
        <span>
          <UserRound size={13} />
          {task.agent_name || t('card.unknownAgent')}
        </span>
        <span>
          <Clock size={13} />
          {t('card.due')} {formatSchedDate(task.due_date)}
        </span>
      </div>
      <div className="sched-task-text">{task.task_text}</div>
      <div className="sched-task-meta">
        <Calendar size={13} />
        {t('card.added')} {formatSchedDate(task.created_at)}
      </div>
      {ended && (
        <div className="sched-task-meta">
          <CalendarCheck size={13} />
          {t('card.ended')} {formatSchedDate(task.ended_at)}
        </div>
      )}
      <div className="sched-task-actions">
        {ended ? (
          <span className={`sched-ended-tag${isLate ? ' late' : ''}`}>
            {task.delivery_status ? (
              <>
                {isLate ? <AlarmClock size={12} /> : <CheckCircle size={12} />}
                {isLate ? t('card.lateDelivery') : t('card.deliveredOnTime')}
              </>
            ) : (
              <>
                <CheckCircle size={12} />
                {t('card.endedTag')}
              </>
            )}
          </span>
        ) : (
          <button className="sched-end-btn" disabled={task._pending} onClick={() => onEnd(task.id, task.contact_id)}>
            <Check size={13} />
            {t('card.endTask')}
          </button>
        )}
      </div>
    </div>
  );
}
