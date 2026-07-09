const express = require('express');
const router = express.Router();
const teamController = require('../controllers/team.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// إدارة التيمز نفسها (صفحة الإعدادات)
router.get('/api/teams', asyncHandler(teamController.list));
router.post('/api/teams', requireAdmin, asyncHandler(teamController.create));
router.put('/api/teams/:id', requireAdmin, asyncHandler(teamController.update));
router.delete('/api/teams/:id', requireAdmin, asyncHandler(teamController.remove));

// أعضاء التيم (إضافة إيجنتس حقيقيين مسجلين في النظام)
router.get('/api/teams/:id/members', asyncHandler(teamController.getMembers));
router.post('/api/teams/:id/members', requireAdmin, asyncHandler(teamController.setMembers));

module.exports = router;
