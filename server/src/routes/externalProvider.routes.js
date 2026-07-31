const express = require('express');
const router = express.Router();
const externalProviderController = require('../controllers/externalProvider.controller');
const externalMergeController = require('../controllers/externalMerge.controller');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// ===== إدارة اتصالات شات ووت (أدمن بس) =====
router.post('/api/external-providers', requireAdmin, asyncHandler(externalProviderController.createProvider));
router.get('/api/external-providers', requireAdmin, asyncHandler(externalProviderController.listProviders));
router.get('/api/external-providers/:id', requireAdmin, asyncHandler(externalProviderController.getProvider));
router.patch('/api/external-providers/:id', requireAdmin, asyncHandler(externalProviderController.updateProvider));
router.patch('/api/external-providers/:id/active', requireAdmin, asyncHandler(externalProviderController.setActive));
router.post(
  '/api/external-providers/:id/regenerate-secret',
  requireAdmin,
  asyncHandler(externalProviderController.regenerateSecret)
);

// ===== الميرج (أدمن بس) =====
router.get(
  '/api/external-providers/:providerId/unmerged-contacts',
  requireAdmin,
  asyncHandler(externalMergeController.listUnmergedContacts)
);
router.post('/api/external-contacts/:id/merge', requireAdmin, asyncHandler(externalMergeController.mergeContact));
router.post('/api/external-contacts/:id/unmerge', requireAdmin, asyncHandler(externalMergeController.unmergeContact));

router.get(
  '/api/external-providers/:providerId/unmerged-agents',
  requireAdmin,
  asyncHandler(externalMergeController.listUnmergedAgents)
);
router.post(
  '/api/external-providers/:providerId/sync-agents',
  requireAdmin,
  asyncHandler(externalMergeController.syncAgents)
);
router.post('/api/external-agents/:id/merge', requireAdmin, asyncHandler(externalMergeController.mergeAgent));
router.post('/api/external-agents/:id/unmerge', requireAdmin, asyncHandler(externalMergeController.unmergeAgent));
router.patch('/api/external-agents/:id/token', requireAdmin, asyncHandler(externalMergeController.setAgentToken));

module.exports = router;
