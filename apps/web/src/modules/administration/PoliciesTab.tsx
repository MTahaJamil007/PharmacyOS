import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState } from 'react';

import { adminGet, adminPatch } from '../../api';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Input,
  MoneyInput,
  useToast,
} from '../../components/ui';
import { formatDateTime, isMoneyText } from '../../format';
import { blankToNull, type FiscalSettings, type OperationalPolicies } from './admin-types';

type PolicyForm = Record<
  | 'basicDiscountLimitPercent'
  | 'cashVarianceApprovalThreshold'
  | 'expiryCriticalDays'
  | 'expiryHighDays'
  | 'expiryModerateDays'
  | 'targetCoverageDays'
  | 'shelfLookbackDays'
  | 'regulatedRetentionYears',
  string
>;

function toForm(policies: OperationalPolicies): PolicyForm {
  return {
    basicDiscountLimitPercent: policies.basicDiscountLimitPercent,
    cashVarianceApprovalThreshold: policies.cashVarianceApprovalThreshold,
    expiryCriticalDays: String(policies.expiryCriticalDays),
    expiryHighDays: String(policies.expiryHighDays),
    expiryModerateDays: String(policies.expiryModerateDays),
    regulatedRetentionYears: String(policies.regulatedRetentionYears),
    shelfLookbackDays: String(policies.shelfLookbackDays),
    targetCoverageDays: String(policies.targetCoverageDays),
  };
}

function whole(value: string, min: number, max: number): boolean {
  return /^\d{1,4}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;
}

export function PoliciesTab() {
  return (
    <div className="stack">
      <ShopRules />
      <FiscalIdentity />
    </div>
  );
}

function ShopRules() {
  const policies = useQuery({
    queryKey: ['admin', 'policies'],
    queryFn: () => adminGet<OperationalPolicies>('/policies'),
  });
  if (!policies.data) {
    return (
      <Card title="Shop rules">
        <ErrorAlert error={policies.error} />
        {policies.isLoading ? <div className="skeleton" style={{ height: 120 }} /> : null}
      </Card>
    );
  }
  return <ShopRulesForm key={policies.data.updatedAt} policies={policies.data} />;
}

function ShopRulesForm({ policies }: { readonly policies: OperationalPolicies }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PolicyForm>(() => toForm(policies));
  const [regimenCheck, setRegimenCheck] = useState(policies.requireRegimenVerification);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problems: Record<keyof PolicyForm, string | undefined> = {
    basicDiscountLimitPercent:
      /^\d{1,3}(?:\.\d{1,2})?$/.test(form.basicDiscountLimitPercent.trim()) &&
      Number(form.basicDiscountLimitPercent) <= 100
        ? undefined
        : '0 to 100',
    cashVarianceApprovalThreshold: isMoneyText(form.cashVarianceApprovalThreshold)
      ? undefined
      : 'An amount like 500',
    expiryCriticalDays: whole(form.expiryCriticalDays, 1, 365) ? undefined : '1 to 365',
    expiryHighDays: !whole(form.expiryHighDays, 2, 730)
      ? '2 to 730'
      : Number(form.expiryHighDays) <= Number(form.expiryCriticalDays)
        ? 'Must be more than the urgent window'
        : undefined,
    expiryModerateDays: !whole(form.expiryModerateDays, 3, 1095)
      ? '3 to 1,095'
      : Number(form.expiryModerateDays) <= Number(form.expiryHighDays)
        ? 'Must be more than the soon window'
        : undefined,
    regulatedRetentionYears: whole(form.regulatedRetentionYears, 3, 25) ? undefined : '3 to 25',
    shelfLookbackDays: whole(form.shelfLookbackDays, 7, 365) ? undefined : '7 to 365',
    targetCoverageDays: whole(form.targetCoverageDays, 1, 365) ? undefined : '1 to 365',
  };
  const valid = Object.values(problems).every((problem) => !problem);
  const set = (field: keyof PolicyForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await adminPatch('/policies', {
        basicDiscountLimitPercent: form.basicDiscountLimitPercent.trim(),
        cashVarianceApprovalThreshold: form.cashVarianceApprovalThreshold.trim(),
        expiryCriticalDays: Number(form.expiryCriticalDays),
        expiryHighDays: Number(form.expiryHighDays),
        expiryModerateDays: Number(form.expiryModerateDays),
        regulatedRetentionYears: Number(form.regulatedRetentionYears),
        requireRegimenVerification: regimenCheck,
        shelfLookbackDays: Number(form.shelfLookbackDays),
        targetCoverageDays: Number(form.targetCoverageDays),
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
      toast.success('Shop rules saved');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Shop rules"
      description={`Last changed ${formatDateTime(policies.updatedAt)}`}
      footer={
        <Button
          variant="primary"
          icon={Save}
          loading={busy}
          disabled={!valid}
          onClick={() => void save()}
        >
          Save rules
        </Button>
      }
    >
      <div className="form-stack">
        <div className="form-section-title">Money controls</div>
        <div className="form-grid">
          <Field
            label="Discount a cashier may give without a supervisor (%)"
            error={problems.basicDiscountLimitPercent}
          >
            <Input
              inputMode="decimal"
              value={form.basicDiscountLimitPercent}
              onChange={set('basicDiscountLimitPercent')}
            />
          </Field>
          <Field
            label="Cash difference that needs a manager's approval"
            hint="Drawer shortages or excesses above this are held for approval"
            error={problems.cashVarianceApprovalThreshold}
          >
            <MoneyInput
              value={form.cashVarianceApprovalThreshold}
              onChange={set('cashVarianceApprovalThreshold')}
            />
          </Field>
        </div>
        <div className="form-section-title">Expiry warnings (days before expiry)</div>
        <div className="form-grid three">
          <Field label="Urgent" error={problems.expiryCriticalDays}>
            <Input
              inputMode="numeric"
              value={form.expiryCriticalDays}
              onChange={set('expiryCriticalDays')}
            />
          </Field>
          <Field label="Soon" error={problems.expiryHighDays}>
            <Input
              inputMode="numeric"
              value={form.expiryHighDays}
              onChange={set('expiryHighDays')}
            />
          </Field>
          <Field label="Watch" error={problems.expiryModerateDays}>
            <Input
              inputMode="numeric"
              value={form.expiryModerateDays}
              onChange={set('expiryModerateDays')}
            />
          </Field>
        </div>
        <div className="form-section-title">Stock planning and records</div>
        <div className="form-grid three">
          <Field label="Reorder to cover (days of sales)" error={problems.targetCoverageDays}>
            <Input
              inputMode="numeric"
              value={form.targetCoverageDays}
              onChange={set('targetCoverageDays')}
            />
          </Field>
          <Field label="Shelf analysis looks back (days)" error={problems.shelfLookbackDays}>
            <Input
              inputMode="numeric"
              value={form.shelfLookbackDays}
              onChange={set('shelfLookbackDays')}
            />
          </Field>
          <Field label="Keep regulated records (years)" error={problems.regulatedRetentionYears}>
            <Input
              inputMode="numeric"
              value={form.regulatedRetentionYears}
              onChange={set('regulatedRetentionYears')}
            />
          </Field>
        </div>
        <Checkbox
          label="Budget planner results must be verified by a pharmacist"
          checked={regimenCheck}
          onChange={setRegimenCheck}
        />
        <ErrorAlert error={error} />
      </div>
    </Card>
  );
}

const NTN = /^\d{7}(?:\d{2}|\d{6})?$/;
const SCENARIO = /^SN\d{3}$/;

function FiscalIdentity() {
  const settings = useQuery({
    queryKey: ['admin', 'fiscal-settings'],
    queryFn: () => adminGet<FiscalSettings>('/fiscal-settings'),
  });
  if (!settings.data) {
    return (
      <Card title="Tax registration (FBR)">
        <ErrorAlert error={settings.error} />
        {settings.isLoading ? <div className="skeleton" style={{ height: 120 }} /> : null}
      </Card>
    );
  }
  return <FiscalIdentityForm key={JSON.stringify(settings.data)} settings={settings.data} />;
}

function FiscalIdentityForm({ settings }: { readonly settings: FiscalSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<keyof FiscalSettings, string>>(() => ({
    businessName: settings.businessName ?? '',
    posRegistrationNumber: settings.posRegistrationNumber ?? '',
    province: settings.province ?? '',
    scenarioId: settings.scenarioId ?? '',
    sellerNtnCnic: settings.sellerNtnCnic ?? '',
    sellerStrn: settings.sellerStrn ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problems = {
    businessName:
      form.businessName.trim() && form.businessName.trim().length < 2
        ? 'At least 2 characters'
        : undefined,
    province:
      form.province.trim() && form.province.trim().length < 2 ? 'At least 2 characters' : undefined,
    scenarioId:
      form.scenarioId.trim() && !SCENARIO.test(form.scenarioId.trim()) ? 'Format SN001' : undefined,
    sellerNtnCnic:
      form.sellerNtnCnic.trim() && !NTN.test(form.sellerNtnCnic.trim())
        ? '7-digit NTN, 9 digits, or 13-digit CNIC without dashes'
        : undefined,
  };
  const valid = Object.values(problems).every((problem) => !problem);
  const set = (field: keyof FiscalSettings) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await adminPatch('/fiscal-settings', {
        businessName: blankToNull(form.businessName),
        posRegistrationNumber: blankToNull(form.posRegistrationNumber),
        province: blankToNull(form.province),
        scenarioId: blankToNull(form.scenarioId),
        sellerNtnCnic: blankToNull(form.sellerNtnCnic),
        sellerStrn: blankToNull(form.sellerStrn),
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'fiscal-settings'] });
      toast.success('Tax registration saved', 'New receipts will print these details.');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Tax registration (FBR)"
      description="Printed on every receipt and sent with FBR invoices."
      footer={
        <Button
          variant="primary"
          icon={Save}
          loading={busy}
          disabled={!valid}
          onClick={() => void save()}
        >
          Save registration
        </Button>
      }
    >
      <div className="form-stack">
        {!form.sellerNtnCnic.trim() || !form.posRegistrationNumber.trim() ? (
          <Alert tone="warning">
            FBR needs the NTN and the POS registration number on every invoice. Fill both in before
            FBR submission is switched on.
          </Alert>
        ) : null}
        <div className="form-grid">
          <Field label="Registered business name">
            <Input value={form.businessName} maxLength={200} onChange={set('businessName')} />
          </Field>
          <Field label="Province" error={problems.province}>
            <Input
              value={form.province}
              placeholder="Punjab"
              maxLength={120}
              onChange={set('province')}
            />
          </Field>
          <Field label="NTN or CNIC" error={problems.sellerNtnCnic}>
            <Input
              className="mono"
              inputMode="numeric"
              value={form.sellerNtnCnic}
              onChange={set('sellerNtnCnic')}
            />
          </Field>
          <Field label="Sales tax registration (STRN)" optional>
            <Input
              className="mono"
              value={form.sellerStrn}
              maxLength={64}
              onChange={set('sellerStrn')}
            />
          </Field>
          <Field label="FBR POS registration number">
            <Input
              className="mono"
              value={form.posRegistrationNumber}
              maxLength={120}
              onChange={set('posRegistrationNumber')}
            />
          </Field>
          <Field
            label="Sandbox scenario"
            optional
            hint="Only while testing with FBR, e.g. SN001"
            error={problems.scenarioId}
          >
            <Input className="mono" value={form.scenarioId} onChange={set('scenarioId')} />
          </Field>
        </div>
        <ErrorAlert error={error} />
      </div>
    </Card>
  );
}
