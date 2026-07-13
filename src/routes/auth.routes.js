const express = require('express');
const multer = require('multer');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/admin');
const { asyncHandler } = require('../utils/helpers');

const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
router.post('/api/me/avatar', requireAuth, uploadAvatar.single('avatar'), asyncHandler(authController.uploadAvatar));
router.delete('/api/me/avatar', requireAuth, asyncHandler(authController.removeAvatar));
router.post('/api/me/change-password', requireAuth, asyncHandler(authController.changePassword));
router.get('/api/me/notification-prefs', requireAuth, asyncHandler(authController.getNotificationPreferences));
router.put('/api/me/notification-prefs', requireAuth, asyncHandler(authController.updateNotificationPreferences));
router.get('/api/me/access-token', requireAuth, asyncHandler(authController.getAccessToken));
router.post('/api/me/access-token/regenerate', requireAuth, asyncHandler(authController.regenerateAccessToken));
router.get('/api/agents-list', requireAuth, asyncHandler(authController.listAgents));

// ===== إدارة المستخدمين (admin فقط) =====
router.get('/api/users', requireAuth, requireAdmin, asyncHandler(authController.listUsers));
router.post('/api/users', requireAuth, requireAdmin, asyncHandler(authController.createUserAccount));
router.patch('/api/users/:id', requireAuth, requireAdmin, asyncHandler(authController.updateUserAccount));
router.delete('/api/users/:id', requireAuth, requireAdmin, asyncHandler(authController.deleteUserAccount));

module.exports = router;
