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
router.patch('/api/contacts/:id', asyncHandler(contactController.updateContact));
router.patch('/api/contacts/:id/phones', asyncHandler(contactController.updatePhoneLabel));
router.post('/api/conversations/:id/contact', asyncHandler(contactController.linkConversationContact));

// كارت عميل الصيانة (زرار Add Contact في صفحة Contacts + تعديله بعد كده) — أدمن بس
router.post('/api/contacts/customer-card', requireAdmin, asyncHandler(contactController.createCustomerCard));
router.patch('/api/contacts/:id/customer-card', requireAdmin, asyncHandler(contactController.updateCustomerCard));

module.exports = router;
