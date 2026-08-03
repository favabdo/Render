const express = require('express');
const router = express.Router();
const multer = require('multer');
const conversationController = require('../controllers/conversation.controller');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');
const { createTimer } = require('../utils/timing');

// بنحط تايمر حقيقي على كل request جاي للراوتر ده *قبل* requireAuth، عشان مرحلة
// الـ authentication نفسها (JWT verify + status check) تتقاس هي كمان مش بس اللي
// بعدها. req.timing مش بيأثر على أي حاجة تانية — أي كود تاني بيستخدمه بس لو
// موجود (شوف middleware/auth.js وconversation.controller.js)
router.use((req, res, next) => {
  req.timing = createTimer();
  req.timing.mark('request:start');
  next();
});

// بنستقبل الملف في الذاكرة (مش على الديسك مباشرة) عشان نقدر نستخدم نفس الـ
// buffer مرتين: مرة نخزنه محليًا للعرض الفوري في الشات، ومرة نرفعه لواتساب.
// حد أقصى 30MB للملف الواحد (WhatsApp Cloud API عمومًا بيقبل لحد 16MB للوسائط
// العادية و100MB للمستندات، فالحد ده معقول لمعظم الاستخدامات)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/api/conversations', asyncHandler(conversationController.listConversations));
router.get('/api/conversations/:id/messages', asyncHandler(conversationController.getConversationMessages));
router.post('/api/conversations/:id/assign', asyncHandler(conversationController.assign));
router.post('/api/conversations/:id/resolve', asyncHandler(conversationController.resolve));
router.post('/api/conversations/:id/reopen', asyncHandler(conversationController.reopen));
router.post('/api/conversations/:id/reply', asyncHandler(conversationController.reply));
router.post('/api/conversations/:id/reply-media', upload.single('file'), asyncHandler(conversationController.replyMedia));
router.post('/api/conversations/:id/notes', asyncHandler(conversationController.addNote));
router.post('/api/conversations/:id/notes/media', upload.single('file'), asyncHandler(conversationController.addNoteMedia));
router.delete('/api/conversations/:id/messages/:messageId', asyncHandler(conversationController.deleteMessage));
router.post('/api/conversations/:id/generate-reply', asyncHandler(conversationController.generateReply));

module.exports = router;
