// controllers/team.controller.js
const repo = require('../repositories/team.repo');
const logger = require('../utils/logger');

const ALLOWED_STRATEGIES = ['manual', 'round_robin', 'balanced'];

async function list(req, res) {
  const items = await repo.listTeams();
  res.json(items);
}

async function create(req, res) {
  const { name, description, icon, color, routingStrategy } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التيم' });

  const strategy = ALLOWED_STRATEGIES.includes(routingStrategy) ? routingStrategy : 'manual';

  const created = await repo.createTeam({
    name: name.trim(),
    description: description || null,
    icon: icon || 'users-round',
    color: color || '#6C5CE7',
    routingStrategy: strategy,
    createdBy: req.user.userId,
  });
  res.status(201).json(created);

  broadcastTeamsList(req);
}

async function update(req, res) {
  const { name, description, icon, color, routingStrategy } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'لازم تكتب اسم التيم' });

  const strategy = ALLOWED_STRATEGIES.includes(routingStrategy) ? routingStrategy : 'manual';

  const updated = await repo.updateTeam(req.params.id, {
    name: name.trim(),
    description: description || null,
    icon: icon || 'users-round',
    color: color || '#6C5CE7',
    routingStrategy: strategy,
  });
  if (!updated) return res.status(404).json({ error: 'التيم ده مش موجود' });
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

module.exports = {
  list,
  create,
  update,
  remove,
  getMembers,
  setMembers,
};
