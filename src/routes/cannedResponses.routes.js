const express = require('express');
const router = express.Router();
const cannedResponseController = require('../controllers/cannedResponse.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/canned-responses', asyncHandler(cannedResponseController.list));
router.post('/api/canned-responses', asyncHandler(cannedResponseController.create));
router.patch('/api/canned-responses/reorder', asyncHandler(cannedResponseController.reorder));
router.put('/api/canned-responses/:id', asyncHandler(cannedResponseController.update));
router.delete('/api/canned-responses/:id', asyncHandler(cannedResponseController.remove));

module.exports = router;
