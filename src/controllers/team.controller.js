// controllers/team.controller.js
const repo = require('../repositories/team.repo');
const conversationRepo = require('../repositories/conversation.repo');
const logger = require('../utils/logger');

// ملحوظة: اتشالت فكرة "Routing Strategy" خالص من الفورم (كانت select يدوي) واتستبدلت
// بإضافة إيجنتس حقيقيين للتيم مباشرة وقت الإنشاء/التعديل (agentIds). عمود routing_strategy
// فاضل في الداتابيز كـ default 'manual' بس مش بيتعرض ولا بيتحدّث من الواجهة تاني.

async function list(req, res) {
  const items = await repo.listTeams();
  res.json(items);
}

async function create(req, res) {
  const { name, description, icon, color, agentIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التيم' });

  const created = await repo.createTeam({
    name: name.trim(),
    description: description || null,
    icon: icon || 'users-round',
    color: color || '#6C5CE7',
    createdBy: req.user.userId,
  });

  if (Array.isArray(agentIds) && agentIds.length > 0) {
    await repo.setMembersForTeam(created.id, agentIds);
  }

  res.status(201).json(created);

  broadcastTeamsList(req);
}

async function update(req, res) {
  const { name, description, icon, color, agentIds } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التيم' });

  const updated = await repo.updateTeam(req.params.id, {
    name: name.trim(),
    description: description || null,
    icon: icon || 'users-round',
    color: color || '#6C5CE7',
  });
  if (!updated) return res.status(404).json({ error: 'التيم ده مش موجود' });

  if (Array.isArray(agentIds)) {
    await repo.setMembersForTeam(req.params.id, agentIds);
  }

  res.json(updated);

  broadcastTeamsList(req);
}

async function remove(req, res) {
  const deleted = await repo.deleteTeam(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'التيم ده مش موجود' });
  res.json({ ok: true });

  broadcastTeamsList(req);
}

// بتبعت قايمة التيمز المحدّثة لكل الإيجنتس المتصلين لحظيًا (زي فكرة الليبلز بالظبط)
function broadcastTeamsList(req) {
  const io = req.app.get('io');
  if (!io) return;
  repo
    .listTeams()
    .then((teams) => io.emit('teams_updated', teams))
    .catch((err) => logger.error('❌ فشل بث تحديث التيمز:', err.message));
}

async function getMembers(req, res) {
  const team = await repo.getTeamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'التيم ده مش موجود' });
  const members = await repo.getMembersForTeam(req.params.id);
  res.json(members);
}

async function setMembers(req, res) {
  const { agentIds } = req.body;
  if (!Array.isArray(agentIds)) {
    return res.status(400).json({ error: 'لازم تبعت agentIds كـ array' });
  }
  const team = await repo.getTeamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'التيم ده مش موجود' });

  const members = await repo.setMembersForTeam(req.params.id, agentIds);
  res.json({ ok: true, members });

  broadcastTeamsList(req);
}

// ===== ربط التيمز بمحادثة معينة (نفس فكرة label.controller.js بالظبط) =====

async function listForConversation(req, res) {
  const teams = await repo.listTeamsForConversation(req.params.id);
  res.json(teams);
}

async function addToConversation(req, res) {
  const { teamId } = req.body || {};
  if (!teamId) return res.status(400).json({ error: 'لازم تبعت teamId' });

  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const teams = await repo.addTeamToConversation(req.params.id, teamId);

  const io = req.app.get('io');
  if (io) io.emit('conversation_teams_updated', { conversationId: req.params.id, teams });

  res.json({ ok: true, teams });
}

async function removeFromConversation(req, res) {
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const teams = await repo.removeTeamFromConversation(req.params.id, req.params.teamId);

  const io = req.app.get('io');
  if (io) io.emit('conversation_teams_updated', { conversationId: req.params.id, teams });

  res.json({ ok: true, teams });
}

module.exports = {
  list,
  create,
  update,
  remove,
  getMembers,
  setMembers,
  listForConversation,
  addToConversation,
  removeFromConversation,
};
