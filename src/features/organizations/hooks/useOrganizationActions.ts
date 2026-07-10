'use client';

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { confirmDialog } from '@/components/ui/AppDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { accountingApi } from '@/lib/accountingApi';
import { useWorkspaceActions } from '@/features/workspace/hooks/useWorkspaceActions';
import { emptyOrganizationForm } from '@/features/organizations/forms';
import type { ClientForm, ImportClientReview, Organization, OrganizationForm, Section } from '@/shared/types';

type UseOrganizationActionsParams = {
 organizationForm: OrganizationForm;
 setOrganizationForm: Dispatch<SetStateAction<OrganizationForm>>;
 selectedOrganizationForClients: Organization | null;
 setSelectedOrganizationForClients: Dispatch<SetStateAction<Organization | null>>;
 navigateToSection: (section: Section) => void;
 setOrgDialogError: Dispatch<SetStateAction<string>>;
 setIsSavingOrg: Dispatch<SetStateAction<boolean>>;
 setShowCreateOrgDialog: Dispatch<SetStateAction<boolean>>;
 orgDialogTargetReviewKey: string | null;
 setOrgDialogTargetReviewKey: Dispatch<SetStateAction<string | null>>;
 updateImportReviewEntry: (key: string, patch: Partial<ImportClientReview>) => void;
 clientForm: ClientForm;
 setClientForm: Dispatch<SetStateAction<ClientForm>>;
};

/**
 * Organization CRUD handlers. Kept together with the create-org-dialog
 * submit since that dialog is opened from both the Organizations tab and the
 * client-import review flow (see orgDialogTargetReviewKey / updateImportReviewEntry).
 */
export function useOrganizationActions({
 organizationForm,
 setOrganizationForm,
 selectedOrganizationForClients,
 setSelectedOrganizationForClients,
 navigateToSection,
 setOrgDialogError,
 setIsSavingOrg,
 setShowCreateOrgDialog,
 orgDialogTargetReviewKey,
 setOrgDialogTargetReviewKey,
 updateImportReviewEntry,
 clientForm,
 setClientForm,
}: UseOrganizationActionsParams) {
 const { language } = useLanguage();
 const { t } = useTranslation(language);
 const { invalidate: loadData, setters, setError } = useWorkspaceActions();
 const setOrganizations = setters.setOrganizations as Dispatch<SetStateAction<Organization[]>>;

async function onOrganizationSubmit(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!organizationForm.name.trim()) {
  setError(t('organization_required'));
  return;
 }

 try {
  if (organizationForm.id) {
   await accountingApi.updateOrganization(organizationForm);
  } else {
   await accountingApi.createOrganization(organizationForm);
  }

  setOrganizationForm(emptyOrganizationForm());
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_update'));
 }
}

async function onCreateOrgFromDialog(event: FormEvent<HTMLFormElement>) {
 event.preventDefault();
 if (!accountingApi || !organizationForm.name.trim()) {
  setOrgDialogError(t('organization_required'));
  return;
 }
 const newName = organizationForm.name.trim();
 setIsSavingOrg(true);
 setOrgDialogError('');
 try {
  await accountingApi.createOrganization(organizationForm);
  await loadData();
  // Auto-select the newly created org in whichever form opened the dialog.
  setOrganizations((freshOrgs) => {
   const newOrg = freshOrgs.find((o) => o.name === newName);
   if (newOrg) {
    if (orgDialogTargetReviewKey) {
     updateImportReviewEntry(orgDialogTargetReviewKey, { organizationId: newOrg.id });
    } else {
     setClientForm((current) => ({ ...current, organizationId: newOrg.id }));
    }
   }
   return freshOrgs;
  });
  setOrganizationForm(emptyOrganizationForm());
  setShowCreateOrgDialog(false);
  setOrgDialogTargetReviewKey(null);
 } catch (e) {
  setOrgDialogError(e instanceof Error ? e.message : t('error_failed_save'));
 } finally {
  setIsSavingOrg(false);
 }
}

async function onDeleteOrganization(id: number) {
 if (!accountingApi) {
  setError(t('error_bridge'));
  return;
 }

 if (!(await confirmDialog({ message: t('organization_delete_confirm'), confirmText: t('delete'), tone: 'danger' }))) {
  return;
 }

 try {
  await accountingApi.deleteOrganization(id);
  if (organizationForm.id === id) {
   setOrganizationForm(emptyOrganizationForm());
  }
  if (selectedOrganizationForClients?.id === id) {
   setSelectedOrganizationForClients(null);
   navigateToSection('organizations');
  }
  if (clientForm.organizationId === id) {
   setClientForm((current) => ({ ...current, organizationId: null }));
  }
  setError('');
  await loadData();
 } catch (e) {
  setError(e instanceof Error ? e.message : t('error_failed_delete'));
 }
}

 return { onOrganizationSubmit, onCreateOrgFromDialog, onDeleteOrganization };
}
