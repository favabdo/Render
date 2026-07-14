// controllers/scheduledTask.controller.js
// قسم "Scheduled Tasks" في لوحة العميل — لما عميل يطلب حاجة، الإيجنت يقدر يجدولها
// ليوم تاني بدل ما ينساها. اسم الإيجنت بيجي من جلسة تسجيل الدخول (req.user)، مش من
// حاجة بتتبعت من الفرونت، عشان محدش يقدر يزوّر مين اللي جدول التاسك.
const scheduledTaskRepo = require('../repositories/scheduledTask.repo');
const contactRepo = require('../repositories/contact.repo');
const userRepo = require('../repositories/user.repo');
const notificationService = require('../services/notification.service');

async function listTasks(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const tasks = await scheduledTaskRepo.listScheduledTasksForContact(req.params.contactId);
  res.json(tasks);
}

// كل التاسكات من كل العملاء — لصفحة "Scheduled Tasks" في السايد بار
async function listAllTasks(req, res) {
  const tasks = await scheduledTaskRepo.listAllScheduledTasks();
  res.json(tasks);
}

async function addTask(req, res) {
  const { taskText, dueDate, customerName } = req.body || {};
  const trimmedTask = (taskText || '').trim();
  if (!trimmedTask) return res.status(400).json({ error: 'لازم تكتب التاسك المطلوب' });
  if (!dueDate) return res.status(400).json({ error: 'لازم تحدد تاريخ التسليم' });

  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  // اسم الإيجنت بيتحدد من الجلسة الحالية بس (مش من الفرونت)
  const agent = await userRepo.findUserById(req.user.userId);
  const agentName = agent ? userRepo.resolveDisplayName(agent) : (req.user.email || 'Unknown');

  const task = await scheduledTaskRepo.addScheduledTask(req.params.contactId, {
    customerName: (customerName || contact.name || '').trim() || null,
    taskText: trimmedTask,
    agentId: req.user.userId,
    agentName,
    dueDate,
  });

  const io = req.app.get('io');
  if (io) io.emit('scheduled_task_added', { contactId: req.params.contactId, task });

  res.status(201).json({ ok: true, task });

  notificationService.logActivity(req, `أضاف تاسك جديد للعميل ${contact.name || ''}`, task.id);
}

async function endTask(req, res) {
  const existing = await scheduledTaskRepo.getScheduledTaskById(req.params.taskId);
  if (!existing || String(existing.contact_id) !== String(req.params.contactId)) {
    return res.status(404).json({ error: 'التاسك دي مش موجودة' });
  }

  const task = await scheduledTaskRepo.endScheduledTask(req.params.taskId);
  if (!task) return res.status(409).json({ error: 'التاسك دي مقفولة بالفعل' });

  const io = req.app.get('io');
  if (io) io.emit('scheduled_task_ended', { contactId: req.params.contactId, task });

  res.json({ ok: true, task });
}

module.exports = { listTasks, listAllTasks, addTask, endTask };
