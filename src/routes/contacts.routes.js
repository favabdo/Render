const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

router.use(requireAuth);

router.get('/api/contacts', asyncHandler(contactController.listContacts));
router.get('/api/contacts/:id', asyncHandler(contactController.getContact));
router.get('/api/contacts/:id/conversations', asyncHandler(contactController.getContactConversations));

// تعديل اسم العميل، ليبل الأرقام، إضافة/دمج/فصل الأرقام — أدمن/أونر بس، مش أي إيجنت
router.patch('/api/contacts/:id', requireAdmin, asyncHandler(contactController.updateContact));
router.patch('/api/contacts/:id/phones', requireAdmin, asyncHandler(contactController.updatePhoneLabel));
router.post('/api/contacts/:id/phones', requireAdmin, asyncHandler(contactController.addPhone));
router.post('/api/contacts/:id/phones/unlink', requireAdmin, asyncHandler(contactController.unlinkPhone));
router.post('/api/conversations/:id/contact', requireAdmin, asyncHandler(contactController.linkConversationContact));

// كارت عميل الصيانة (زرار Add Contact في صفحة Contacts + تعديله بعد كده) — أدمن بس
router.post('/api/contacts/customer-card', requireAdmin, asyncHandler(contactController.createCustomerCard));
router.patch('/api/contacts/:id/customer-card', requireAdmin, asyncHandler(contactController.updateCustomerCard));

module.exports = router;
