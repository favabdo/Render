// controllers/resolveCategory.controller.js
const repo = require('../repositories/resolveCategory.repo');
const notificationService = require('../services/notification.service');

async function list(req, res) {
  const items = await repo.listResolveCategories();
  res.json(items);
}

async function create(req, res) {
  const { name, icon, description, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التصنيف' });

  const created = await repo.createResolveCategory({
    name: name.trim(),
    icon: icon || '📋',
    description: description || null,
    color: color || 'rgba(108,92,231,0.1)',
    createdBy: req.user.userId,
  });
  res.status(201).json(created);
  notificationService.logActivity(req, `أضاف تصنيف إغلاق جديد "${created.name}"`, created.id);
}

async function update(req, res) {
  const { name, icon, description, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التصنيف' });

  const updated = await repo.updateResolveCategory(req.params.id, {
    name: name.trim(),
    icon: icon || '📋',
    description: description || null,
    color: color || 'rgba(108,92,231,0.1)',
  });
  if (!updated) return res.status(404).json({ error: 'التصنيف ده مش موجود' });
  res.json(updated);
  notificationService.logActivity(req, `عدّل تصنيف إغلاق "${updated.name}"`, updated.id);
}

async function remove(req, res) {
  await repo.deleteResolveCategory(req.params.id);
  res.json({ ok: true });
  notificationService.logActivity(req, 'مسح تصنيف إغلاق', req.params.id);
}

// بيستقبل { orderedIds: [3,1,2,...] } بالترتيب الجديد بعد السحب في الواجهة
async function reorder(req, res) {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'لازم تبعت orderedIds كمصفوفة' });
  }
  await repo.reorderResolveCategories(orderedIds);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove, reorder };
