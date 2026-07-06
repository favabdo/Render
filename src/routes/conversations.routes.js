const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversation.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/conversations', asyncHandler(conversationController.listConversations));
router.get('/api/conversations/:id/messages', asyncHandler(conversationController.getConversationMessages));
router.post('/api/conversations/:id/assign', asyncHandler(conversationController.assign));
router.post('/api/conversations/:id/resolve', asyncHandler(conversationController.resolve));
router.post('/api/conversations/:id/reopen', asyncHandler(conversationController.reopen));
router.post('/api/conversations/:id/reply', asyncHandler(conversationController.reply));
router.post('/api/conversations/:id/notes', asyncHandler(conversationController.addNote));

module.exports = router;
