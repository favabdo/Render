const express = require('express');
const router = express.Router();
const resolveCategoryController = require('../controllers/resolveCategory.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/resolve-categories', asyncHandler(resolveCategoryController.list));
router.post('/api/resolve-categories', asyncHandler(resolveCategoryController.create));
router.patch('/api/resolve-categories/reorder', asyncHandler(resolveCategoryController.reorder));
router.put('/api/resolve-categories/:id', asyncHandler(resolveCategoryController.update));
router.delete('/api/resolve-categories/:id', asyncHandler(resolveCategoryController.remove));

module.exports = router;
