const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/contacts/:contactId/devices', asyncHandler(deviceController.listDevices));
router.post('/api/contacts/:contactId/devices', asyncHandler(deviceController.addDevice));
router.patch('/api/contacts/:contactId/devices/:deviceId', asyncHandler(deviceController.updateDevice));
router.delete('/api/contacts/:contactId/devices/:deviceId', asyncHandler(deviceController.deleteDevice));

module.exports = router;
