import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RotateCcw } from 'lucide-react';
import useAuthStore from '../../../store/authStore';
import useToastStore from '../../../store/toastStore';
import { ACCENT_COLOR_PRESETS, DEFAULT_ACCENT_COLOR, getStoredAccentColor, resetAccentColor, setAccentColor } from '../../../theme/accentColor';

// زرار اختيار "لون الطابع" الشخصي بتاع الإيجنت — بيتحكم في لون رسايلنا احنا
// (اللي بنبعتها)، خلفية أفتار/اسم العميل، لون كل الزرارات، ولون تظليل
// السكشن اللي واقفين عليه في الشريط الجانبي. اللون بيتطبّق فورًا مع كل تغيير
// (Live preview)، ومحفوظ محليًا لكل إيجنت لوحده على الجهاز ده
export default function AccentColorPicker() {
  const { t } = useTranslation('profile');
  const { user } = useAuthStore();
  const showToast = useToastStore((s) => s.showToast);
  const [color, setColor] = useState(() => getStoredAccentColor(user?.id));

  function pick(hex) {
    setColor(hex);
    setAccentColor(user?.id, hex);
    showToast(t('accentColor.saved'), 'success');
  }

  function handleReset() {
    setColor(DEFAULT_ACCENT_COLOR);
    resetAccentColor(user?.id);
    showToast(t('accentColor.resetDone'), 'info');
  }

  return (
    <div className="settings-section">
      <h3>{t('accentColor.title')}</h3>
      <div className="setting-desc" style={{ marginBottom: 14 }}>
        {t('accentColor.desc')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {ACCENT_COLOR_PRESETS.map((hex) => {
          const active = color.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => pick(hex)}
              title={hex}
              aria-label={hex}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: hex,
                border: active ? '2.5px solid var(--text)' : '2.5px solid transparent',
                boxShadow: active ? '0 0 0 2px var(--surface), 0 0 0 4px ' + hex : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                padding: 0,
              }}
            >
              {active && <Check size={15} color="#fff" strokeWidth={3} />}
            </button>
          );
        })}

        {/* Color picker حر لأي لون خارج القايمة الجاهزة */}
        <label
          title={t('accentColor.customColor')}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            cursor: 'pointer',
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
            border: '2.5px dashed var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg)',
            fontSize: 15,
          }}
        >
          🎨
          <input
            type="color"
            value={color}
            onChange={(e) => pick(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
          />
        </label>

        <button
          type="button"
          className="st-icon-btn"
          style={{ width: 'auto', padding: '6px 12px', gap: 6, display: 'inline-flex', background: 'var(--bg)', fontSize: 12 }}
          onClick={handleReset}
        >
          <RotateCcw size={13} /> {t('accentColor.reset')}
        </button>
      </div>
    </div>
  );
}
