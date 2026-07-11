const express = require('express');
const router = express.Router();
const scheduledTaskController = require('../controllers/scheduledTask.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/scheduled-tasks', asyncHandler(scheduledTaskController.listAllTasks));
router.get('/api/contacts/:contactId/scheduled-tasks', asyncHandler(scheduledTaskController.listTasks));
router.post('/api/contacts/:contactId/scheduled-tasks', asyncHandler(scheduledTaskController.addTask));
router.patch('/api/contacts/:contactId/scheduled-tasks/:taskId/end', asyncHandler(scheduledTaskController.endTask));

module.exports = router;
