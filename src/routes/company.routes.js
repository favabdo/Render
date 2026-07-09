const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

// أي إيجنت مسجل دخول يقدر يشوف اسم/كود الشركة (Account Settings عرض بس)
router.get('/api/company/settings', requireAuth, asyncHandler(companyController.getSettings));

// التعديل (اسم الشركة + عدد أيام الـ Auto Resolve) للـ admin/owner بس
router.patch('/api/company/settings', requireAuth, requireAdmin, asyncHandler(companyController.updateSettings));

module.exports = router;
