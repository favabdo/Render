const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.get('/api/notifications', requireAuth, asyncHandler(notificationController.list));
router.get('/api/notifications/unread-count', requireAuth, asyncHandler(notificationController.unreadCount));
router.patch('/api/notifications/:id', requireAuth, asyncHandler(notificationController.setStatus));
router.post('/api/notifications/mark-all-read', requireAuth, asyncHandler(notificationController.markAllRead));

module.exports = router;
