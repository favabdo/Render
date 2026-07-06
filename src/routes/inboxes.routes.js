const express = require('express');
const router = express.Router();
const inboxController = require('../controllers/inbox.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/inboxes/channels', inboxController.listChannels);
router.post('/api/inboxes/whatsapp/authenticate', requireAdmin, asyncHandler(inboxController.authenticateWhatsapp));
router.post('/api/inboxes', requireAdmin, asyncHandler(inboxController.createInbox));
router.get('/api/inboxes', asyncHandler(inboxController.listInboxes));
router.patch('/api/inboxes/:id', requireAdmin, asyncHandler(inboxController.updateInboxStatus));
router.delete('/api/inboxes/:id', requireAdmin, asyncHandler(inboxController.deleteInbox));
router.get('/api/inboxes/:id/agents', asyncHandler(inboxController.getInboxAgents));
router.post('/api/inboxes/:id/agents', requireAdmin, asyncHandler(inboxController.setInboxAgents));
router.get('/api/inboxes-available-agents', asyncHandler(inboxController.listAvailableAgents));

module.exports = router;
