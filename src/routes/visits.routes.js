const express = require('express');
const router = express.Router();
const visitController = require('../controllers/visit.controller');
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// زيارات عميل معين — بتتعرض في صفحة تفاصيل العميل
router.get('/api/contacts/:contactId/visits', asyncHandler(visitController.listVisitsForContact));
router.post('/api/contacts/:contactId/visits', asyncHandler(visitController.addVisitForContact));

// إضافة زيارة من برة (زرار جمب Add Contact في صفحة Contacts) — متاحة لكل
// الصلاحيات، بتقبل contactId (لو اختار عميل موجود) أو customerName (اسم يدوي)
router.post('/api/visits', asyncHandler(visitController.addVisitStandalone));

module.exports = router;
