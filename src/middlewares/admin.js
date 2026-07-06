// middlewares/admin.js
// لازم يترّكب بعد requireAuth عشان req.user يكون موجود

function requireAdmin(req, res, next) {
  if (req.user?.role > 1) {
    return res.status(403).json({ error: 'محتاج صلاحية admin' });
  }
  next();
}

module.exports = { requireAdmin };
