import type { Customer } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../api';
import { AdminTabs } from '../components/Layout';
import { Dialog, ErrorText, Field, Loading, PageError, useLoad, useSubmit } from '../components/ui';

export function CustomersPage() {
  const { t } = useTranslation();
  const { data, error, reload } = useLoad(() => get<Customer[]>('/api/customers'), []);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  if (error) return <PageError code={error} />;
  return (
    <div className="page">
      <h1>{t('nav.admin')}</h1>
      <AdminTabs />
      <div className="section-head">
        <p className="muted">{t('admin.customersIntro')}</p>
        <button className="primary" onClick={() => setEditing('new')}>
          + {t('admin.newCustomer')}
        </button>
      </div>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <div className="empty">
          <p>{t('admin.noCustomers')}</p>
        </div>
      ) : (
        <ul className="card plain-list">
          {data.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <button className="small" onClick={() => setEditing(c)}>
                {t('common.rename')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CustomerDialog
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), void reload())}
        />
      )}
    </div>
  );
}

function CustomerDialog({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(customer?.name ?? '');
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (customer) await patch(`/api/admin/customers/${customer.id}`, { name });
    else await post('/api/admin/customers', { name });
    onSaved();
  });
  return (
    <Dialog title={customer ? t('common.rename') : t('admin.newCustomer')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t('projects.customerName')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} autoFocus />
        </Field>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
