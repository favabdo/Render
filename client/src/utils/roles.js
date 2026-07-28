import i18n from '../i18n';

export function roleLabel(role) {
  return role === 0
    ? i18n.t('roles.superAdmin', { ns: 'common' })
    : role === 1
      ? i18n.t('roles.administrator', { ns: 'common' })
      : role === 3
        ? i18n.t('roles.crmAgent', { ns: 'common' })
        : i18n.t('roles.agent', { ns: 'common' });
}

// رول 3 = "CRM Agent": بيشوف بس قسم العملاء (Contacts) وبالقراءة بس. الحماية
// الحقيقية من السيرفر (middleware/auth.js -> enforceCrmAgentAccess)، وده بس
// بيخفي عناصر الواجهة اللي مالهاش لازمة تظهر أصلاً له
export function isCrmAgentOnly(user) {
  return user?.role === 3;
}

export function roleBadgeClass(role) {
  return role <= 1 ? 'role-admin' : 'role-agent';
}
