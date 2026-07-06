const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { findUserByEmail, verifyPassword, resolveDisplayName } = require('./usersRepo');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'لازم تبعت email و password' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'بيانات الدخول غلط' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'الحساب موقوف، تواصل مع الإدارة' });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'بيانات الدخول غلط' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: resolveDisplayName(user),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حصل خطأ في السيرفر' });
  }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'لازم تسجل دخول' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'الجلسة منتهية، سجل دخول تاني' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role > 1) {
    return res.status(403).json({ error: 'محتاج صلاحية admin' });
  }
  next();
}

module.exports = { router, requireAuth, requireAdmin, JWT_SECRET };
