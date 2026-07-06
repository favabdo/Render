const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

// تسجيل الدخول
router.post('/auth/login', asyncHandler(authController.login));

// إنشاء أول موظف (مرة واحدة بس)
router.post('/api/setup/first-user', asyncHandler(authController.createFirstUser));

// ===== دعوة إيجنت جديد بالإيميل (لينك تسجيل بدون auth، بيتفتح من الإيميل) =====
router.get('/api/invite/:token', asyncHandler(authController.getInviteInfo));
router.post('/api/invite/:token/accept', asyncHandler(authController.acceptInvite));

// ===== البروفايل الشخصي (أي إيجنت مسجل دخول، مش لازم يكون admin) =====
router.get('/api/me', requireAuth, asyncHandler(authController.getMe));
router.patch('/api/me', requireAuth, asyncHandler(authController.updateMe));
router.get('/api/agents-list', requireAuth, asyncHandler(authController.listAgents));

// ===== إدارة المستخدمين (admin فقط) =====
router.get('/api/users', requireAuth, requireAdmin, asyncHandler(authController.listUsers));
router.post('/api/users', requireAuth, requireAdmin, asyncHandler(authController.createUserAccount));
router.patch('/api/users/:id', requireAuth, requireAdmin, asyncHandler(authController.updateUserAccount));
router.delete('/api/users/:id', requireAuth, requireAdmin, asyncHandler(authController.deleteUserAccount));

module.exports = router;
