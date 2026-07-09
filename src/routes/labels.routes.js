const express = require('express');
const router = express.Router();
const labelController = require('../controllers/label.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// إدارة الليبلز نفسها (صفحة الإعدادات)
router.get('/api/labels', asyncHandler(labelController.list));
router.post('/api/labels', asyncHandler(labelController.create));
router.put('/api/labels/:id', asyncHandler(labelController.update));
router.delete('/api/labels/:id', asyncHandler(labelController.remove));

// ربط/فك ربط ليبل بمحادثة معينة
router.get('/api/conversations/:id/labels', asyncHandler(labelController.listForConversation));
router.post('/api/conversations/:id/labels', asyncHandler(labelController.addToConversation));
router.delete('/api/conversations/:id/labels/:labelId', asyncHandler(labelController.removeFromConversation));

module.exports = router;
