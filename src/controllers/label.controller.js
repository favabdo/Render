// controllers/label.controller.js
const repo = require('../repositories/label.repo');
const conversationRepo = require('../repositories/conversation.repo');
const logger = require('../utils/logger');

// ===== إدارة الليبلز نفسها (Settings > Labels) =====

async function list(req, res) {
  const items = await repo.listLabels();
  res.json(items);
}

async function create(req, res) {
  const { name, color, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم الليبل' });

  const created = await repo.createLabel({
    name: name.trim(),
    color: color || '#6C5CE7',
    description: description || null,
    createdBy: req.user.userId,
  });
  res.status(201).json(created);
}

async function update(req, res) {
  const { name, color, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم الليبل' });

  const updated = await repo.updateLabel(req.params.id, {
    name: name.trim(),
    color: color || '#6C5CE7',
    description: description || null,
  });
  if (!updated) return res.status(404).json({ error: 'الليبل ده مش موجود' });
  res.json(updated);
}

async function remove(req, res) {
  await repo.deleteLabel(req.params.id);
  res.json({ ok: true });
}

// ===== ربط الليبلز بمحادثة معينة =====

async function listForConversation(req, res) {
  const labels = await repo.listLabelsForConversation(req.params.id);
  res.json(labels);
}

async function addToConversation(req, res) {
  const { labelId } = req.body || {};
  if (!labelId) return res.status(400).json({ error: 'لازم تبعت labelId' });

  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const labels = await repo.addLabelToConversation(req.params.id, labelId);

  const io = req.app.get('io');
  if (io) io.emit('conversation_labels_updated', { conversationId: req.params.id, labels });

  res.json({ ok: true, labels });
}

async function removeFromConversation(req, res) {
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const labels = await repo.removeLabelFromConversation(req.params.id, req.params.labelId);

  const io = req.app.get('io');
  if (io) io.emit('conversation_labels_updated', { conversationId: req.params.id, labels });

  res.json({ ok: true, labels });
}

module.exports = {
  list,
  create,
  update,
  remove,
  listForConversation,
  addToConversation,
  removeFromConversation,
};
