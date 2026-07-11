const express = require('express');
const router = express.Router();
const webhookConfigController = require('../controllers/webhookConfig.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// إدارة الـ Webhooks الصادرة (Settings → Integrations → Webhooks)
router.get('/api/webhooks', asyncHandler(webhookConfigController.list));
router.post('/api/webhooks', requireAdmin, asyncHandler(webhookConfigController.create));
router.put('/api/webhooks/:id', requireAdmin, asyncHandler(webhookConfigController.update));
router.delete('/api/webhooks/:id', requireAdmin, asyncHandler(webhookConfigController.remove));
router.post('/api/webhooks/:id/regenerate-secret', requireAdmin, asyncHandler(webhookConfigController.regenerateSecret));
router.post('/api/webhooks/:id/test', requireAdmin, asyncHandler(webhookConfigController.sendTestEvent));

module.exports = router;
