import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const englishMessages = {
  'app.name': 'PharmacyOS',
  'app.tagline': 'Pharmacy operations',
  'group.sell': 'Sell',
  'group.stock': 'Stock',
  'group.money': 'Money',
  'group.system': 'System',
  'nav.counter': 'Counter',
  'nav.returns': 'Returns',
  'nav.customers': 'Customers',
  'nav.budget': 'Budget planner',
  'nav.inventory': 'Inventory',
  'nav.purchasing': 'Purchasing',
  'nav.cash': 'Cash drawer',
  'nav.owner': 'Dashboard',
  'nav.reports': 'Reports',
  'nav.operations': 'Operations',
  'nav.admin': 'Settings',
  'nav.collapse': 'Collapse menu',
  'nav.expand': 'Expand menu',
  'status.checking': 'Checking server',
  'status.ready': 'Server connected',
  'status.unavailable': 'Server unreachable',
  'status.tillOpen': 'Till open',
  'status.tillClosed': 'Till closed',
  'status.tillCounting': 'Variance pending',
  'auth.signOut': 'Sign out',
  'auth.changePassword': 'Change password',
  'auth.sessionExpired': 'Your session has ended',
  'auth.reauthenticate': 'Sign in again to continue. Nothing on this counter has been lost.',
  'auth.continue': 'Continue',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.terminal': 'Terminal code',
  'auth.signIn': 'Sign in',
  'pos.findMedicine': 'Find medicine',
  'pos.searchPlaceholder': 'Search by brand, generic, company, or scan a barcode',
  'pos.currentCart': 'Current sale',
  'pos.newSale': 'New sale',
  'pos.holdCart': 'Hold / resume',
  'pos.reprint': 'Find receipt',
  'pos.takePayment': 'Take payment',
  'pos.discount': 'Discount',
  'pos.cancelSale': 'Cancel sale',
  'language.switch': 'اردو',
} as const;

type MessageKey = keyof typeof englishMessages;
type Locale = 'en' | 'ur';

const urduMessages: Record<MessageKey, string> = {
  'app.name': 'فارمیسی او ایس',
  'app.tagline': 'فارمیسی آپریشنز',
  'group.sell': 'فروخت',
  'group.stock': 'اسٹاک',
  'group.money': 'رقم',
  'group.system': 'سسٹم',
  'nav.counter': 'کاؤنٹر',
  'nav.returns': 'واپسی',
  'nav.customers': 'گاہک',
  'nav.budget': 'بجٹ پلانر',
  'nav.inventory': 'انوینٹری',
  'nav.purchasing': 'خریداری',
  'nav.cash': 'کیش دراز',
  'nav.owner': 'ڈیش بورڈ',
  'nav.reports': 'رپورٹس',
  'nav.operations': 'آپریشنز',
  'nav.admin': 'ترتیبات',
  'nav.collapse': 'مینو چھوٹا کریں',
  'nav.expand': 'مینو بڑا کریں',
  'status.checking': 'سرور چیک ہو رہا ہے',
  'status.ready': 'سرور سے منسلک',
  'status.unavailable': 'سرور دستیاب نہیں',
  'status.tillOpen': 'دراز کھلا ہے',
  'status.tillClosed': 'دراز بند ہے',
  'status.tillCounting': 'فرق کی منظوری باقی',
  'auth.signOut': 'سائن آؤٹ',
  'auth.changePassword': 'پاس ورڈ تبدیل کریں',
  'auth.sessionExpired': 'آپ کا سیشن ختم ہو گیا',
  'auth.reauthenticate':
    'جاری رکھنے کے لیے دوبارہ سائن ان کریں۔ کاؤنٹر کا کوئی ڈیٹا ضائع نہیں ہوا۔',
  'auth.continue': 'جاری رکھیں',
  'auth.username': 'صارف نام',
  'auth.password': 'پاس ورڈ',
  'auth.terminal': 'ٹرمینل کوڈ',
  'auth.signIn': 'سائن ان',
  'pos.findMedicine': 'دوا تلاش کریں',
  'pos.searchPlaceholder': 'برانڈ، جنیرک، کمپنی سے تلاش کریں یا بار کوڈ اسکین کریں',
  'pos.currentCart': 'موجودہ فروخت',
  'pos.newSale': 'نئی فروخت',
  'pos.holdCart': 'روکیں / بحال کریں',
  'pos.reprint': 'رسید تلاش',
  'pos.takePayment': 'ادائیگی لیں',
  'pos.discount': 'رعایت',
  'pos.cancelSale': 'فروخت منسوخ کریں',
  'language.switch': 'English',
};

export type { MessageKey };

interface I18nValue {
  readonly locale: Locale;
  readonly direction: 'ltr' | 'rtl';
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  try {
    return localStorage.getItem('pharmacy-locale') === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { readonly children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const direction = locale === 'ur' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);
  const value = useMemo<I18nValue>(
    () => ({
      direction,
      locale,
      setLocale: (next) => {
        try {
          localStorage.setItem('pharmacy-locale', next);
        } catch {
          // A locked-down browser profile still gets the change for this session.
        }
        setLocaleState(next);
      },
      t: (key) => (locale === 'ur' ? urduMessages[key] : englishMessages[key]),
    }),
    [direction, locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const englishFallback: I18nValue = {
  direction: 'ltr',
  locale: 'en',
  setLocale: () => undefined,
  t: (key) => englishMessages[key],
};

/** Outside a provider (isolated component tests) the interface reads in English. */
export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? englishFallback;
}
