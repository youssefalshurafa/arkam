'use client';

import type { Dispatch, SetStateAction } from 'react';
import AccountSettings from '@/components/account/AccountSettings';
import TeamSettings from '@/components/account/TeamSettings';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { renderIcon } from '@/shared/utils/icons';
import { panelClassName } from '@/shared/styles';
import LanguageSettings from '@/features/settings/components/LanguageSettings';
import AppearanceSettings from '@/features/settings/components/AppearanceSettings';
import DangerZone from '@/features/settings/components/DangerZone';
import PdfSettingsTab from '@/features/settings/components/PdfSettings';
import LiveRatesSettings from '@/features/settings/components/LiveRatesSettings';
import DatabaseSettings from '@/features/settings/components/DatabaseSettings';
import ClientsSection from '@/features/clients/components/ClientsSection';
import OrganizationsSection from '@/features/organizations/components/OrganizationsSection';
import CurrenciesSection from '@/features/currencies/components/CurrenciesSection';
import ExchangeSettingsTab from '@/features/settings/components/ExchangeSettings';
import type {
 Client,
 ClientAccount,
 Currency,
 Organization,
 OrganizationForm,
 SettingsTab,
 Transaction,
} from '@/shared/types';

type SettingsSectionProps = {
 settingsTabs: Array<{ key: SettingsTab; label: string; icon: import('@/shared/types').IconName }>;
 settingsTab: SettingsTab;
 setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
 error: string;
 importSummary: string;
 setImportSummary: Dispatch<SetStateAction<string>>;
 isEditorRole: boolean;
 isWorkspaceOwner: boolean;
 sharedSettingsEnabled: boolean;
 setWorkspaceSharedSettingsEnabled: (enabled: boolean) => void;
 isBackingUp: boolean;
 isRestoringBackup: boolean;
 backupRestoreInputRef: React.RefObject<HTMLInputElement | null>;
 lastBackupAt: string | null;
 lastBackupLabel: () => string;
 onDownloadBackup: () => void;
 onRestoreBackupFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
 transactions: Transaction[];
 clients: Client[];
 onDeleteAllTransactions: () => void;
 onDeleteAllClients: () => void;
 organizations: Organization[];
 clientAccounts: ClientAccount[];
 enabledCurrencies: Currency[];
 sortedClients: Client[];
 paginatedClients: Client[];
 clampedClientsPage: number;
 totalClientPages: number;
 accountsClient: Client | null;
 clientSortHeader: (key: 'name' | 'organization', label: string) => React.ReactNode;
 onClientSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
 isSubmittingClient: boolean;
 onDeleteClient: (id: number) => void;
 onAddClientAccount: (clientId: number) => void;
 onDeleteClientAccount: (accountId: number) => void;
 onMoveAccountTransactions: (fromAccountId: number) => void;
 onSaveEditAccount: () => void;
 openClientLedger: (client: Client, origin?: 'clients' | 'organization-clients', accountId?: number | null) => void;
 setShowCreateOrgDialog: Dispatch<SetStateAction<boolean>>;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
 organizationForm: OrganizationForm;
 onOrganizationSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
 onDeleteOrganization: (id: number) => void;
 openOrganizationClientsPage: (organization: Organization) => void;
 localizedCurrencies: Currency[];
};

export default function SettingsSection({
 settingsTabs,
 settingsTab,
 setSettingsTab,
 error,
 importSummary,
 setImportSummary,
 isEditorRole,
 isWorkspaceOwner,
 sharedSettingsEnabled,
 setWorkspaceSharedSettingsEnabled,
 isBackingUp,
 isRestoringBackup,
 backupRestoreInputRef,
 lastBackupAt,
 lastBackupLabel,
 onDownloadBackup,
 onRestoreBackupFile,
 transactions,
 clients,
 onDeleteAllTransactions,
 onDeleteAllClients,
 organizations,
 clientAccounts,
 enabledCurrencies,
 sortedClients,
 paginatedClients,
 clampedClientsPage,
 totalClientPages,
 accountsClient,
 clientSortHeader,
 onClientSubmit,
 isSubmittingClient,
 onDeleteClient,
 onAddClientAccount,
 onDeleteClientAccount,
 onMoveAccountTransactions,
 onSaveEditAccount,
 openClientLedger,
 setShowCreateOrgDialog,
 setOrganizationForm,
 organizationForm,
 onOrganizationSubmit,
 onDeleteOrganization,
 openOrganizationClientsPage,
 localizedCurrencies,
}: SettingsSectionProps) {
 const { language, isRTL } = useLanguage();
 const { t } = useTranslation(language);

 return (
 <section className="flex flex-col gap-0">
  {/* Settings section header */}
  <div className="border-b-2 border-blue-800 bg-surface px-5 py-4">
   <div className="flex items-center gap-3">
    <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-blue-800 text-white">{renderIcon('settings', 'h-4 w-4')}</span>
    <div>
     <h2 className="text-base font-bold text-fg">{t('settings_title')}</h2>
     <p className="text-xs text-fg-faint">{t('settings_description')}</p>
    </div>
   </div>
   {/* Tab strip */}
   <div className="mt-4 flex flex-wrap gap-0 border-b border-border -mb-px">
    {settingsTabs.map((tab) => {
     const isActive = settingsTab === tab.key;
     return (
      <button
       key={tab.key}
       type="button"
       onClick={() => setSettingsTab(tab.key)}
       className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
        isActive ? 'border-blue-700 text-accent' : 'border-transparent text-fg-faint hover:border-border-strong hover:text-fg-muted'
       }`}
      >
       {renderIcon(tab.icon, 'h-4 w-4')}
       {tab.label}
      </button>
     );
    })}
   </div>
  </div>
  {/* Active tab content */}
  <div className="flex flex-col gap-4 p-4">
   {error ? <div className="rounded border border-red-300 bg-bad-bg px-4 py-2 text-sm text-bad-text">{error}</div> : null}
   {importSummary ? (
    <div className="flex items-start justify-between gap-3 rounded border border-green-300 bg-good-bg px-4 py-2 text-sm text-good-text">
     <span>{importSummary}</span>
     <button
      type="button"
      onClick={() => setImportSummary('')}
      aria-label={t('close')}
      title={t('close')}
      className="-mr-1 shrink-0 rounded p-0.5 text-good-text transition hover:bg-good-bg hover:text-good-text"
     >
      <svg
       width="16"
       height="16"
       viewBox="0 0 24 24"
       fill="none"
       stroke="currentColor"
       strokeWidth="2"
       strokeLinecap="round"
       strokeLinejoin="round"
       aria-hidden
      >
       <path d="M18 6 6 18M6 6l12 12" />
      </svg>
     </button>
    </div>
   ) : null}
   {settingsTab === 'account' ? <AccountSettings hideSubscription={isEditorRole} /> : null}
   {settingsTab === 'team' ? (
    <div className="flex flex-col gap-6">
     <TeamSettings />
     {isWorkspaceOwner ? (
      <div className={panelClassName}>
       <div className="flex items-start justify-between gap-4">
        <div>
         <h3 className="text-lg font-semibold">{t('shared_settings_title')}</h3>
         <p className="mt-1 text-sm text-fg-muted">{t('shared_settings_description')}</p>
        </div>
        <button
         type="button"
         role="switch"
         aria-checked={sharedSettingsEnabled}
         onClick={() => setWorkspaceSharedSettingsEnabled(!sharedSettingsEnabled)}
         className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${sharedSettingsEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
         {/* translate-x is physical, so in RTL the knob must move the opposite way or it
             slides off the track — flip the sign when the layout is right-to-left. */}
         <span
          className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition ${
           sharedSettingsEnabled ? (isRTL ? '-translate-x-5' : 'translate-x-5') : isRTL ? '-translate-x-0.5' : 'translate-x-0.5'
          }`}
         />
        </button>
       </div>
       {sharedSettingsEnabled ? <p className="mt-3 text-xs text-fg-faint">{t('shared_settings_active_hint')}</p> : null}
      </div>
     ) : null}
    </div>
   ) : null}
   {settingsTab === 'database' ? (
    <DatabaseSettings
     isBackingUp={isBackingUp}
     isRestoringBackup={isRestoringBackup}
     backupRestoreInputRef={backupRestoreInputRef}
     lastBackupAt={lastBackupAt}
     lastBackupLabel={lastBackupLabel}
     onDownloadBackup={onDownloadBackup}
     onRestoreBackupFile={onRestoreBackupFile}
    />
   ) : null}
   {settingsTab === 'language' ? <LanguageSettings /> : null}
   {settingsTab === 'appearance' ? <AppearanceSettings /> : null}
   {settingsTab === 'pdf' ? <PdfSettingsTab /> : null}
   {settingsTab === 'live-rates' ? <LiveRatesSettings /> : null}
   {settingsTab === 'danger' && !isEditorRole ? (
    <DangerZone
     transactionCount={transactions.length}
     clientCount={clients.length}
     onDeleteAllTransactions={onDeleteAllTransactions}
     onDeleteAllClients={onDeleteAllClients}
    />
   ) : null}
   {settingsTab === 'clients' ? (
    <ClientsSection
     clients={clients}
     organizations={organizations}
     clientAccounts={clientAccounts}
     enabledCurrencies={enabledCurrencies}
     sortedClients={sortedClients}
     paginatedClients={paginatedClients}
     clampedClientsPage={clampedClientsPage}
     totalClientPages={totalClientPages}
     accountsClient={accountsClient}
     clientSortHeader={clientSortHeader}
     onClientSubmit={onClientSubmit}
     isSubmittingClient={isSubmittingClient}
     onDeleteClient={onDeleteClient}
     onAddClientAccount={onAddClientAccount}
     onDeleteClientAccount={onDeleteClientAccount}
     onMoveAccountTransactions={onMoveAccountTransactions}
     onSaveEditAccount={onSaveEditAccount}
     openClientLedger={openClientLedger}
     setShowCreateOrgDialog={setShowCreateOrgDialog}
     setOrganizationForm={setOrganizationForm}
    />
   ) : null}
   {settingsTab === 'organizations' ? (
    <OrganizationsSection
     organizations={organizations}
     organizationForm={organizationForm}
     setOrganizationForm={setOrganizationForm}
     onOrganizationSubmit={onOrganizationSubmit}
     onDeleteOrganization={onDeleteOrganization}
     openOrganizationClientsPage={openOrganizationClientsPage}
    />
   ) : null}
   {settingsTab === 'currencies' ? (
    <div className="flex flex-col gap-4">
     <CurrenciesSection
      localizedCurrencies={localizedCurrencies}
      enabledCurrencies={enabledCurrencies}
      clientAccounts={clientAccounts}
      transactions={transactions}
     />
     <ExchangeSettingsTab />
    </div>
   ) : null}
  </div>
 </section>
 );
}
