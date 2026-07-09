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

// ربط/فك ربط تيم بمحادثة معينة (نفس فكرة labels بالظبط)
router.get('/api/conversations/:id/teams', asyncHandler(teamController.listForConversation));
router.post('/api/conversations/:id/teams', asyncHandler(teamController.addToConversation));
router.delete('/api/conversations/:id/teams/:teamId', asyncHandler(teamController.removeFromConversation));

module.exports = router;
