// controllers/cannedResponse.controller.js
const repo = require('../repositories/cannedResponse.repo');

async function list(req, res) {
  const items = await repo.listCannedResponses();
  res.json(items);
}

async function create(req, res) {
  const { label, text } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'لازم تكتب اسم الزرار (Label)' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'لازم تكتب نص الرد' });

  const created = await repo.createCannedResponse({
    label: label.trim(),
    messageText: text.trim(),
    createdBy: req.user.userId,
  });
  res.status(201).json(created);
}

async function update(req, res) {
  const { label, text } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'لازم تكتب اسم الزرار (Label)' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'لازم تكتب نص الرد' });

  const updated = await repo.updateCannedResponse(req.params.id, {
    label: label.trim(),
    messageText: text.trim(),
  });
  if (!updated) return res.status(404).json({ error: 'الرد ده مش موجود' });
  res.json(updated);
}

async function remove(req, res) {
  await repo.deleteCannedResponse(req.params.id);
  res.json({ ok: true });
}

// بيستقبل { orderedIds: [3,1,2,...] } بالترتيب الجديد بعد السحب في الواجهة
async function reorder(req, res) {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'لازم تبعت orderedIds كمصفوفة' });
  }
  await repo.reorderCannedResponses(orderedIds);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove, reorder };
