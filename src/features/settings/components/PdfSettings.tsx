'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import CustomSelect from '@/shared/components/CustomSelect';
import { panelClassName } from '@/shared/styles';
import { defaultPdfSettings } from '@/shared/lib/localStorage';
import { renderIcon } from '@/shared/utils/icons';
import { buildExportFileName, normalizeFileNameParts } from '@/features/pdf/exportFileName';
import type { ExportFileNamePart, PdfSettings } from '@/shared/types';
import { useSettingsStore } from '../store/settingsStore';

const selectClassName =
 'mt-3 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-blue-400';

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

const FILE_NAME_PART_LABEL_KEYS: Record<ExportFileNamePart, { labelKey: string; hintKey: string }> = {
 type: { labelKey: 'pdf_file_name_part_type', hintKey: 'pdf_file_name_part_type_hint' },
 company: { labelKey: 'pdf_file_name_part_company', hintKey: 'pdf_file_name_part_company_hint' },
 client: { labelKey: 'pdf_file_name_part_client', hintKey: 'pdf_file_name_part_client_hint' },
 currency: { labelKey: 'pdf_file_name_part_currency', hintKey: 'pdf_file_name_part_currency_hint' },
 range: { labelKey: 'pdf_file_name_part_range', hintKey: 'pdf_file_name_part_range_hint' },
};

const SEPARATOR_OPTIONS: { value: PdfSettings['fileNameSeparator']; labelKey: string }[] = [
 { value: ' - ', labelKey: 'pdf_file_name_separator_dash' },
 { value: '_', labelKey: 'pdf_file_name_separator_underscore' },
 { value: ' ', labelKey: 'pdf_file_name_separator_space' },
];

const FILE_NAME_DATE_STYLE_OPTIONS: { value: PdfSettings['fileNameDateStyle']; label: string }[] = [
 { value: 'iso', label: '2026-10-29 (YYYY-MM-DD)' },
 { value: 'dmy', label: '29-10-2026 (DD-MM-YYYY)' },
];

const PREVIEW_LTR_RUN = /(\d{2,4}-\d{2}-\d{2,4}(?:\.pdf)?|\.pdf$)/;

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function PdfSettingsTab() {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const pdfSettings = useSettingsStore((s) => s.pdfSettings);
 const updatePdfSettings = useSettingsStore((s) => s.updatePdfSettings);

 const fileNameParts = normalizeFileNameParts(pdfSettings.fileNameParts);
 const moveFileNamePart = (index: number, offset: -1 | 1) => {
  const next = [...fileNameParts];
  const [part] = next.splice(index, 1);
  next.splice(index + offset, 0, part);
  updatePdfSettings({ fileNameParts: next });
 };
 const toggleFileNamePart = (key: ExportFileNamePart, enabled: boolean) =>
  updatePdfSettings({ fileNameParts: fileNameParts.map((part) => (part.key === key ? { ...part, enabled } : part)) });
 // A sample statement for the current month, so the preview reads like a real export.
 const today = new Date();
 const fileNamePreview = buildExportFileName(
  t,
  pdfSettings,
  {
   type: t('export_file_ledger'),
   client: t('pdf_file_name_sample_client'),
   currency: 'USD',
   fromDate: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
   toDate: isoDay(today),
  },
  'pdf',
 );

 return (
  <section className="flex flex-col gap-6">
   <div className={panelClassName}>
    <h2 className="text-2xl font-semibold">{t('settings_pdf_title')}</h2>
    <p className="mt-2 text-sm text-fg-muted">{t('settings_pdf_description')}</p>

    {/* Company name */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-fg">{t('pdf_company_name_label')}</h3>
     <p className="mt-1 text-xs text-fg-faint">{t('pdf_company_name_hint')}</p>
     <div className="mt-3 flex items-center gap-3">
      <input
       type="text"
       value={pdfSettings.companyName}
       onChange={(e) => updatePdfSettings({ companyName: e.target.value })}
       placeholder={t('pdf_company_name_placeholder')}
       className="w-full max-w-xs rounded border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium text-fg-muted">
       <input
        type="checkbox"
        checked={pdfSettings.showCompanyName}
        onChange={(e) => updatePdfSettings({ showCompanyName: e.target.checked })}
        className="h-4 w-4 rounded border-border-strong text-accent accent-blue-600"
       />
       {t('pdf_company_name_toggle')}
      </label>
     </div>
    </div>

    {/* Font */}
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
     <div>
      <h3 className="text-sm font-semibold text-fg">{t('pdf_font_family_label')}</h3>
      <p className="mt-1 text-xs text-fg-faint">{t('pdf_font_family_hint')}</p>
      <CustomSelect
       value={pdfSettings.fontFamily}
       onChange={(value) => updatePdfSettings({ fontFamily: value })}
       options={FONT_FAMILY_OPTIONS}
       className={selectClassName}
      />
     </div>
     <div>
      <h3 className="text-sm font-semibold text-fg">{t('pdf_font_size_label')}</h3>
      <p className="mt-1 text-xs text-fg-faint">{t('pdf_font_size_hint')}</p>
      <CustomSelect
       value={pdfSettings.fontSize}
       onChange={(value) => updatePdfSettings({ fontSize: value })}
       options={FONT_SIZE_OPTIONS}
       className={selectClassName}
      />
     </div>
     <div>
      <h3 className="text-sm font-semibold text-fg">{t('pdf_head_font_size_label')}</h3>
      <p className="mt-1 text-xs text-fg-faint">{t('pdf_head_font_size_hint')}</p>
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
     <h3 className="text-sm font-semibold text-fg">{t('pdf_date_format_label')}</h3>
     <p className="mt-1 text-xs text-fg-faint">{t('pdf_date_format_hint')}</p>
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
     <h3 className="text-sm font-semibold text-fg">{t('pdf_decimals_label')}</h3>
     <p className="mt-1 text-xs text-fg-faint">{t('pdf_decimals_hint')}</p>
     <div className="mt-3 inline-flex items-center rounded border border-border-strong bg-surface overflow-hidden">
      <button
       type="button"
       onClick={() => updatePdfSettings({ decimals: Math.max(0, pdfSettings.decimals - 1) })}
       className="px-3 py-1.5 text-sm font-bold text-fg-muted hover:bg-surface-hover disabled:opacity-40"
       disabled={pdfSettings.decimals === 0}
      >
       -
      </button>
      <span className="min-w-8 px-2 py-1.5 text-center text-sm font-semibold text-fg border-x border-border-strong">{pdfSettings.decimals}</span>
      <button
       type="button"
       onClick={() => updatePdfSettings({ decimals: Math.min(6, pdfSettings.decimals + 1) })}
       className="px-3 py-1.5 text-sm font-bold text-fg-muted hover:bg-surface-hover disabled:opacity-40"
       disabled={pdfSettings.decimals === 6}
      >
       +
      </button>
     </div>
    </div>

    {/* Section visibility */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-fg">{t('pdf_sections_label')}</h3>
     <p className="mt-1 text-xs text-fg-faint">{t('pdf_sections_hint')}</p>
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
        className="flex cursor-pointer items-start gap-3 rounded border border-border bg-surface-2 px-4 py-3 hover:bg-surface-hover"
       >
        <input
         type="checkbox"
         checked={pdfSettings[key] as boolean}
         onChange={(e) => updatePdfSettings({ [key]: e.target.checked })}
         className="mt-0.5 h-4 w-4 rounded border-border-strong text-accent accent-blue-600"
        />
        <div>
         <p className="text-sm font-medium text-fg">{t(labelKey)}</p>
         <p className="text-xs text-fg-faint">{t(hintKey)}</p>
        </div>
       </label>
      ))}
     </div>
    </div>
   </div>

   {/* File name of exported PDF / Excel files */}
   <div className={panelClassName}>
    <div className="flex items-start justify-between gap-4">
     <div>
      <h2 className="text-2xl font-semibold">{t('pdf_file_name_title')}</h2>
      <p className="mt-2 text-sm text-fg-muted">{t('pdf_file_name_description')}</p>
     </div>
     <button
      type="button"
      onClick={() =>
       updatePdfSettings({
        fileNameParts: defaultPdfSettings.fileNameParts,
        fileNameSeparator: defaultPdfSettings.fileNameSeparator,
        fileNameDateStyle: defaultPdfSettings.fileNameDateStyle,
       })
      }
      className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover"
     >
      {t('pdf_file_name_reset')}
     </button>
    </div>

    {/* Live preview */}
    <div className="mt-4 rounded border border-border bg-surface-2 px-4 py-3">
     <p className="text-xs font-medium text-fg-faint">{t('pdf_file_name_preview')}</p>
     <p className="mt-1 break-all font-mono text-sm text-fg" dir="auto">
      {/* In an Arabic name the bidi algorithm reorders "2026-11-02" into "02-11-2026", so each
          date (and the extension) is isolated left-to-right — display only, the name is unchanged. */}
      {fileNamePreview.split(PREVIEW_LTR_RUN).map((chunk, i) =>
       i % 2 ? (
        <bdi key={i} dir="ltr">
         {chunk}
        </bdi>
       ) : (
        chunk
       ),
      )}
     </p>
    </div>

    {/* Parts: switch on/off and reorder */}
    <div className="mt-6">
     <h3 className="text-sm font-semibold text-fg">{t('pdf_file_name_parts_label')}</h3>
     <p className="mt-1 text-xs text-fg-faint">{t('pdf_file_name_parts_hint')}</p>
     <ul className="mt-3 flex flex-col gap-2">
      {fileNameParts.map((part, index) => {
       const { labelKey, hintKey } = FILE_NAME_PART_LABEL_KEYS[part.key];
       return (
        <li key={part.key} className="flex items-center gap-3 rounded border border-border bg-surface-2 px-4 py-2.5">
         <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
          <input
           type="checkbox"
           checked={part.enabled}
           onChange={(e) => toggleFileNamePart(part.key, e.target.checked)}
           className="mt-0.5 h-4 w-4 rounded border-border-strong text-accent accent-blue-600"
          />
          <div className="min-w-0">
           <p className={`text-sm font-medium ${part.enabled ? 'text-fg' : 'text-fg-faint'}`}>{t(labelKey)}</p>
           <p className="text-xs text-fg-faint">{t(hintKey)}</p>
          </div>
         </label>
         <div className="flex shrink-0 items-center gap-1">
          <button
           type="button"
           onClick={() => moveFileNamePart(index, -1)}
           disabled={index === 0}
           aria-label={t('pdf_file_name_move_up')}
           title={t('pdf_file_name_move_up')}
           className="rounded p-1.5 text-fg-muted hover:bg-surface-hover disabled:opacity-30"
          >
           {renderIcon('arrow-up', 'h-4 w-4')}
          </button>
          <button
           type="button"
           onClick={() => moveFileNamePart(index, 1)}
           disabled={index === fileNameParts.length - 1}
           aria-label={t('pdf_file_name_move_down')}
           title={t('pdf_file_name_move_down')}
           className="rounded p-1.5 text-fg-muted hover:bg-surface-hover disabled:opacity-30"
          >
           {renderIcon('arrow-down', 'h-4 w-4')}
          </button>
         </div>
        </li>
       );
      })}
     </ul>
    </div>

    {/* Separator + date style */}
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
     <div>
      <h3 className="text-sm font-semibold text-fg">{t('pdf_file_name_separator_label')}</h3>
      <p className="mt-1 text-xs text-fg-faint">{t('pdf_file_name_separator_hint')}</p>
      <CustomSelect
       value={pdfSettings.fileNameSeparator}
       onChange={(value) => updatePdfSettings({ fileNameSeparator: value })}
       options={SEPARATOR_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
       className={selectClassName}
      />
     </div>
     <div>
      <h3 className="text-sm font-semibold text-fg">{t('pdf_file_name_date_style_label')}</h3>
      <p className="mt-1 text-xs text-fg-faint">{t('pdf_file_name_date_style_hint')}</p>
      <CustomSelect
       value={pdfSettings.fileNameDateStyle}
       onChange={(value) => updatePdfSettings({ fileNameDateStyle: value })}
       options={FILE_NAME_DATE_STYLE_OPTIONS}
       className={selectClassName}
      />
     </div>
    </div>
   </div>
  </section>
 );
}
