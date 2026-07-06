const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversation.controller');

// الـ webhook بتاع واتساب (من غير auth - بتاع ميتا)
router.get('/webhook', conversationController.verifyWebhook);
router.post('/webhook', conversationController.receiveWebhook);

module.exports = router;
