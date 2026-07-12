const express = require('express');
const router = express.Router();
const maintenanceContractController = require('../controllers/maintenanceContract.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

// سجل عقود الصيانة الكامل لعميل معين — بيتعرض في صفحة تفاصيل العميل جمب الزيارات
router.get('/api/contacts/:contactId/maintenance-contracts', asyncHandler(maintenanceContractController.listContractsForContact));

// إضافة عقد صيانة جديد (تجديد كامل بتاريخ بدء ونهاية) — أدمن/أونر بس، وممنوع لو
// لسه فيه عقد active شغال (متأكد منها في الكنترولر)
router.post('/api/contacts/:contactId/maintenance-contracts', requireAdmin, asyncHandler(maintenanceContractController.addContractForContact));

// إيقاف عقد صيانة شغال — أدمن/أونر بس
router.patch('/api/contacts/:contactId/maintenance-contracts/:contractId/stop', requireAdmin, asyncHandler(maintenanceContractController.stopContract));

// مسح عقد صيانة خالص — أدمن/أونر بس
router.delete('/api/contacts/:contactId/maintenance-contracts/:contractId', requireAdmin, asyncHandler(maintenanceContractController.deleteContract));

module.exports = router;
