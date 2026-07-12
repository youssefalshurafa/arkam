'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import CustomSelect from '@/shared/components/CustomSelect';
import { panelClassName } from '@/shared/styles';
import type { PdfSettings } from '@/shared/types';
import { useSettingsStore } from '../store/settingsStore';

const selectClassName =
 'mt-3 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400';

const FONT_FAMILY_OPTIONS = [
 { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
 { value: "'Cairo', sans-serif", label: 'Cairo' },
 { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
 { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' },
 { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
 { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
 { value: 'Trebuchet MS, Helvetica, sans-serif', label: 'Trebuchet MS' },
 { value: "'Courier New', Courier, monospace", label: 'Courier New' },
];

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 16, 18].map((s) => ({ value: s, label: `${s}px` }));
const HEAD_FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20].map((s) => ({ value: s, label: `${s}px` }));

const DATE_FORMAT_OPTIONS: { value: PdfSettings['dateFormat']; label: string }[] = [
 { value: 'full', label: '2026-06-26 (YYYY-MM-DD)' },
 { value: 'day-month', label: '26/06 (DD/MM)' },
 { value: 'month-day', label: '06/26 (MM/DD)' },
 { value: 'day-month-year-2', label: '26/06/26 (DD/MM/YY)' },
 { value: 'month-year', label: '06/2026 (MM/YYYY)' },
];

export default function PdfSettingsTab() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const updatePdfSettings = useSettingsStore((s) => s.updatePdfSettings);

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_pdf_title')}</h2>
    <p className="mt-2 text-sm text-slate-600">{t('settings_pdf_description')}</p>

    {/* Company name */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-slate-800">{t('pdf_company_name_label')}</h3>
     <p className="mt-1 text-xs text-slate-500">{t('pdf_company_name_hint')}</p>
     <div className="mt-3 flex items-center gap-3">
      <input
       type="text"
       value={pdfSettings.companyName}
       onChange={(e) => updatePdfSettings({ companyName: e.target.value })}
       placeholder={t('pdf_company_name_placeholder')}
       className="w-full max-w-xs rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-700">
       <input
        type="checkbox"
        checked={pdfSettings.showCompanyName}
        onChange={(e) => updatePdfSettings({ showCompanyName: e.target.checked })}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600"
       />
       {t('pdf_company_name_toggle')}
      </label>
     </div>
    </div>

    {/* Font */}
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
     <div>
      <h3 className="text-sm font-semibold text-slate-800">{t('pdf_font_family_label')}</h3>
      <p className="mt-1 text-xs text-slate-500">{t('pdf_font_family_hint')}</p>
      <CustomSelect
       value={pdfSettings.fontFamily}
       onChange={(value) => updatePdfSettings({ fontFamily: value })}
       options={FONT_FAMILY_OPTIONS}
       className={selectClassName}
      />
     </div>
     <div>
      <h3 className="text-sm font-semibold text-slate-800">{t('pdf_font_size_label')}</h3>
      <p className="mt-1 text-xs text-slate-500">{t('pdf_font_size_hint')}</p>
      <CustomSelect
       value={pdfSettings.fontSize}
       onChange={(value) => updatePdfSettings({ fontSize: value })}
       options={FONT_SIZE_OPTIONS}
       className={selectClassName}
      />
     </div>
     <div>
      <h3 className="text-sm font-semibold text-slate-800">{t('pdf_head_font_size_label')}</h3>
      <p className="mt-1 text-xs text-slate-500">{t('pdf_head_font_size_hint')}</p>
      <CustomSelect
       value={pdfSettings.headFontSize}
       onChange={(value) => updatePdfSettings({ headFontSize: value })}
       options={HEAD_FONT_SIZE_OPTIONS}
       className={selectClassName}
      />
     </div>
    </div>

    {/* Date format */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-slate-800">{t('pdf_date_format_label')}</h3>
     <p className="mt-1 text-xs text-slate-500">{t('pdf_date_format_hint')}</p>
     <div className="max-w-xs">
      <CustomSelect
       value={pdfSettings.dateFormat}
       onChange={(value) => updatePdfSettings({ dateFormat: value })}
       options={DATE_FORMAT_OPTIONS}
       className={selectClassName}
      />
     </div>
    </div>

    {/* Decimal places */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-slate-800">{t('pdf_decimals_label')}</h3>
     <p className="mt-1 text-xs text-slate-500">{t('pdf_decimals_hint')}</p>
     <div className="mt-3 inline-flex items-center rounded border border-slate-300 bg-white overflow-hidden">
      <button
       type="button"
       onClick={() => updatePdfSettings({ decimals: Math.max(0, pdfSettings.decimals - 1) })}
       className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
       disabled={pdfSettings.decimals === 0}
      >
       -
      </button>
      <span className="min-w-8 px-2 py-1.5 text-center text-sm font-semibold text-slate-800 border-x border-slate-300">{pdfSettings.decimals}</span>
      <button
       type="button"
       onClick={() => updatePdfSettings({ decimals: Math.min(6, pdfSettings.decimals + 1) })}
       className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
       disabled={pdfSettings.decimals === 6}
      >
       +
      </button>
     </div>
    </div>

    {/* Section visibility */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-slate-800">{t('pdf_sections_label')}</h3>
     <p className="mt-1 text-xs text-slate-500">{t('pdf_sections_hint')}</p>
     <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(
       [
        { key: 'showPreBalance', labelKey: 'pdf_show_pre_balance', hintKey: 'pdf_show_pre_balance_hint' },
        { key: 'showMetaClient', labelKey: 'pdf_show_meta_client', hintKey: 'pdf_show_meta_client_hint' },
        { key: 'showMetaCurrency', labelKey: 'pdf_show_meta_currency', hintKey: 'pdf_show_meta_currency_hint' },
        { key: 'showMetaPeriod', labelKey: 'pdf_show_meta_period', hintKey: 'pdf_show_meta_period_hint' },
        { key: 'showGeneratedOn', labelKey: 'pdf_show_generated_on', hintKey: 'pdf_show_generated_on_hint' },
        { key: 'showCurrencySymbol', labelKey: 'pdf_show_currency_symbol', hintKey: 'pdf_show_currency_symbol_hint' },
        { key: 'highlightNetChange', labelKey: 'pdf_highlight_net_change', hintKey: 'pdf_highlight_net_change_hint' },
        { key: 'showFooter', labelKey: 'pdf_show_footer', hintKey: 'pdf_show_footer_hint' },
       ] as Array<{ key: keyof Omit<PdfSettings, 'decimals' | 'fontFamily' | 'fontSize'>; labelKey: string; hintKey: string }>
      ).map(({ key, labelKey, hintKey }) => (
       <label
        key={key}
        className="flex cursor-pointer items-start gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3 hover:bg-slate-100"
       >
        <input
         type="checkbox"
         checked={pdfSettings[key] as boolean}
         onChange={(e) => updatePdfSettings({ [key]: e.target.checked })}
         className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600"
        />
        <div>
         <p className="text-sm font-medium text-slate-800">{t(labelKey)}</p>
         <p className="text-xs text-slate-500">{t(hintKey)}</p>
        </div>
       </label>
      ))}
     </div>
    </div>
   </div>
  </section>
 );
}
