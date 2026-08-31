import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const englishMessages = {
  'app.name': 'PharmacyOS',
  'nav.counter': 'Counter',
  'nav.cash': 'Cash session',
  'nav.inventory': 'Inventory',
  'nav.budget': 'Budget',
  'nav.returns': 'Returns',
  'nav.owner': 'Owner',
  'status.checking': 'Checking LAN',
  'status.ready': 'LAN ready',
  'status.unavailable': 'LAN unavailable',
  'auth.signOut': 'Sign out',
  'auth.sessionExpired': 'Session expired',
  'auth.reauthenticate': 'Re-enter your password to continue this counter safely.',
  'auth.continue': 'Continue session',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.terminal': 'Terminal code',
  'pos.findMedicine': 'Find medicine',
  'pos.searchPlaceholder': 'Brand, generic, barcode or company',
  'pos.scanHint': 'Scan a barcode or start typing',
  'pos.currentCart': 'Current cart',
  'pos.newSale': 'New sale',
  'pos.holdCart': 'Hold / resume',
  'pos.reprint': 'Receipt search',
  'pos.takePayment': 'Take payment',
} as const;

type MessageKey = keyof typeof englishMessages;
type Locale = 'en' | 'ur';

const urduMessages: Record<MessageKey, string> = {
  'app.name': 'فارمیسی او ایس',
  'nav.counter': 'کاؤنٹر',
  'nav.cash': 'کیش سیشن',
  'nav.inventory': 'انوینٹری',
  'nav.budget': 'بجٹ',
  'nav.returns': 'واپسی',
  'nav.owner': 'مالک',
  'status.checking': 'نیٹ ورک چیک ہو رہا ہے',
  'status.ready': 'نیٹ ورک تیار',
  'status.unavailable': 'نیٹ ورک دستیاب نہیں',
  'auth.signOut': 'سائن آؤٹ',
  'auth.sessionExpired': 'سیشن ختم ہو گیا',
  'auth.reauthenticate': 'محفوظ طریقے سے جاری رکھنے کے لیے پاس ورڈ دوبارہ درج کریں۔',
  'auth.continue': 'سیشن جاری رکھیں',
  'auth.username': 'صارف نام',
  'auth.password': 'پاس ورڈ',
  'auth.terminal': 'ٹرمینل کوڈ',
  'pos.findMedicine': 'دوا تلاش کریں',
  'pos.searchPlaceholder': 'برانڈ، جنیرک، بار کوڈ یا کمپنی',
  'pos.scanHint': 'بار کوڈ اسکین کریں یا ٹائپ کریں',
  'pos.currentCart': 'موجودہ کارٹ',
  'pos.newSale': 'نئی فروخت',
  'pos.holdCart': 'روکیں / بحال کریں',
  'pos.reprint': 'رسید تلاش',
  'pos.takePayment': 'ادائیگی لیں',
};

interface I18nValue {
  readonly locale: Locale;
  readonly direction: 'ltr' | 'rtl';
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  return localStorage.getItem('pharmacy-locale') === 'ur' ? 'ur' : 'en';
}

export function I18nProvider({ children }: { readonly children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const direction = locale === 'ur' ? 'rtl' : 'ltr';
  const setLocale = (next: Locale): void => {
    localStorage.setItem('pharmacy-locale', next);
    setLocaleState(next);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);
  const value = useMemo<I18nValue>(
    () => ({
      direction,
      locale,
      setLocale,
      t: (key) => (locale === 'ur' ? urduMessages[key] : englishMessages[key]),
    }),
    [direction, locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
