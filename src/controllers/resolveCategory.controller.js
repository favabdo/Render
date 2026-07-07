// controllers/resolveCategory.controller.js
const repo = require('../repositories/resolveCategory.repo');

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
}

async function remove(req, res) {
  await repo.deleteResolveCategory(req.params.id);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
