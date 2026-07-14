const notificationRepo = require('../repositories/notification.repo');

// قايمة إشعارات اليوزر الحالي (أحدث 100)، بغض النظر عن حالتها (مقروءة أو لأ)
async function list(req, res) {
  const notifications = await notificationRepo.listForUser(req.user.userId);
  res.json({ notifications });
}

async function unreadCount(req, res) {
  const total = await notificationRepo.countUnreadForUser(req.user.userId);
  res.json({ unread: total });
}

// بيغيّر حالة إشعار واحد بس — status: 1 = جديد، 0 = مقروء (اليوزر يقدر يرجعه
// "جديد" تاني لو حب، مش بس يعلّمه كمقروء)
async function setStatus(req, res) {
  const { status } = req.body || {};
  if (status !== 0 && status !== 1) {
    return res.status(400).json({ error: 'الحالة لازم تكون 0 (مقروء) أو 1 (جديد)' });
  }
  const updated = await notificationRepo.setStatus(req.params.id, req.user.userId, status);
  if (!updated) return res.status(404).json({ error: 'الإشعار مش موجود' });
  res.json({ ok: true, notification: updated });
}

// تعليم كل الإشعارات الحالية (اللي لسه جديدة) كمقروءة دفعة واحدة
async function markAllRead(req, res) {
  await notificationRepo.markAllRead(req.user.userId);
  res.json({ ok: true });
}

module.exports = { list, unreadCount, setStatus, markAllRead };
