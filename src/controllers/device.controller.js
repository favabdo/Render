// controllers/device.controller.js
// قسم "Devices" في لوحة العميل — أجهزة الدعم الفني (AnyDesk) الخاصة بكل عميل (كونتاكت)
const deviceRepo = require('../repositories/device.repo');
const contactRepo = require('../repositories/contact.repo');

async function listDevices(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const devices = await deviceRepo.listDevicesForContact(req.params.contactId);
  res.json(devices);
}

async function addDevice(req, res) {
  const { name, anydesk, pw } = req.body || {};
  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم الجهاز' });

  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const device = await deviceRepo.addDevice(req.params.contactId, {
    name: trimmedName,
    anydesk: (anydesk || '').trim() || null,
    password: (pw || '').trim() || null,
  });

  const io = req.app.get('io');
  if (io) io.emit('device_added', { contactId: req.params.contactId, device });

  res.status(201).json({ ok: true, device });
}

async function updateDevice(req, res) {
  const { name, anydesk, pw } = req.body || {};
  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم الجهاز' });

  const existing = await deviceRepo.getDeviceById(req.params.deviceId);
  if (!existing || String(existing.contact_id) !== String(req.params.contactId)) {
    return res.status(404).json({ error: 'الجهاز ده مش موجود' });
  }

  const device = await deviceRepo.updateDevice(req.params.deviceId, {
    name: trimmedName,
    anydesk: (anydesk || '').trim() || null,
    password: (pw || '').trim() || null,
  });

  const io = req.app.get('io');
  if (io) io.emit('device_updated', { contactId: req.params.contactId, device });

  res.json({ ok: true, device });
}

async function deleteDevice(req, res) {
  const existing = await deviceRepo.getDeviceById(req.params.deviceId);
  if (!existing || String(existing.contact_id) !== String(req.params.contactId)) {
    return res.status(404).json({ error: 'الجهاز ده مش موجود' });
  }

  await deviceRepo.deleteDevice(req.params.deviceId);

  const io = req.app.get('io');
  if (io) io.emit('device_deleted', { contactId: req.params.contactId, deviceId: req.params.deviceId });

  res.json({ ok: true });
}

module.exports = { listDevices, addDevice, updateDevice, deleteDevice };
