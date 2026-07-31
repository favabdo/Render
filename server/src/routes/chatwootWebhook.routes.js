const express = require('express');
const router = express.Router();
const chatwootController = require('../controllers/chatwoot.controller');

// من غير auth (بتاع شات ووت، زي webhook.routes.js بتاع ميتا بالظبط) —
// الحماية هنا بتحصل بالـ providerId + secret في الـ path نفسه
router.post('/webhook/chatwoot/:providerId/:secret', chatwootController.receiveWebhook);

module.exports = router;
