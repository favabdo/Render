import { useTranslation } from 'react-i18next';
import { Calendar, UserRound, Clock } from 'lucide-react';
import { formatSchedDate } from '../../../utils/dateFormat';

export default function VisitCard({ v }) {
  const { t } = useTranslation('customerDetails');
  const timesParts = [];
  if (v.arrival_time) timesParts.push(t('visitCard.arrival', { time: v.arrival_time }));
  if (v.departure_time) timesParts.push(t('visitCard.departure', { time: v.departure_time }));

  return (
    <div className={`sched-task-card${v._pending ? ' opt-pending' : ''}`}>
      <div className="sched-task-subrow">
        <span>
          <Calendar size={13} />
          {formatSchedDate(v.visit_date)}
        </span>
        <span>
          <UserRound size={13} />
          {v.agent_name || t('visitCard.unknownAgent')}
        </span>
      </div>
      <div className="sched-task-text">{v.work_done}</div>
      {timesParts.length > 0 && (
        <div className="sched-task-meta">
          <Clock size={13} />
          {timesParts.join(' · ')}
        </div>
      )}
    </div>
  );
}
