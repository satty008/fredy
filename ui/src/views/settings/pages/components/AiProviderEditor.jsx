/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Button, Input, Modal, Toast } from '@douyinfe/semi-ui-19';

import { useActions, useSelector } from '../../../../services/state/store';
import { errorMessage } from '../../../../services/xhr';
import { useTranslation } from '../../../../services/i18n/i18n.jsx';

/**
 * Create or edit one AI-provider credential.
 *
 * Deliberately its own small component rather than a reuse of NotificationChannelEditor: that one
 * earns its size handling many adapter types with wildly different field shapes and a shared-usage
 * warning banner. There are two AI-provider types, one or two fields each, and the row is never
 * shareable at all (see aiProviderRouter.js) - none of that complexity applies here, and forcing a
 * fit would mean threading a "does this concept even exist for this editor" flag through that whole
 * component instead.
 *
 * @param {Object} props
 * @param {boolean} props.visible
 * @param {'create'|'edit'} props.mode
 * @param {string} [props.providerId] - Required for edit.
 * @param {string} [props.adapterId] - Required for create.
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved]
 * @returns {React.ReactElement|null}
 */
export default function AiProviderEditor({ visible, mode, providerId = null, adapterId = null, onClose, onSaved }) {
  const t = useTranslation();
  const actions = useActions();
  const types = useSelector((state) => state.aiProviders.types);

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const typeDef = types.find((type) => type.id === (draft?.adapterId ?? adapterId)) ?? null;

  useEffect(() => {
    if (!visible) {
      setDraft(null);
      return undefined;
    }
    if (mode === 'create') {
      setDraft({ adapterId, name: typeDef?.name ?? '', fields: {} });
      return undefined;
    }
    let cancelled = false;
    actions.aiProviders.loadProvider(providerId).then((provider) => {
      if (!cancelled)
        setDraft({
          id: provider.id,
          adapterId: provider.adapterId,
          name: provider.name,
          fields: { ...provider.fields },
        });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, mode, providerId, adapterId]);

  if (!visible || draft == null) return null;

  const setField = (key, value) => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));

  const save = async () => {
    if (draft.name.trim().length === 0) {
      Toast.error(t('aiRating.providerNameRequired'));
      return;
    }
    setSaving(true);
    try {
      await actions.aiProviders.saveProvider({
        id: draft.id,
        adapterId: draft.adapterId,
        name: draft.name.trim(),
        fields: draft.fields,
      });
      Toast.success(t('aiRating.providerSaved'));
      onSaved?.();
      onClose();
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        mode === 'create' ? t('aiRating.addProviderTitle', { type: typeDef?.name }) : t('aiRating.editProviderTitle')
      }
      visible={visible}
      onCancel={onClose}
      footer={
        <>
          <Button theme="borderless" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button theme="solid" type="primary" loading={saving} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label>{t('aiRating.providerNameLabel')}</label>
          <Input
            value={draft.name}
            onChange={(value) => setDraft((d) => ({ ...d, name: value }))}
            placeholder={t('aiRating.providerNamePlaceholder')}
          />
        </div>
        {typeDef?.fields.map((field) => (
          <div key={field.key}>
            <label>{field.label}</label>
            <Input
              mode={field.secret ? 'password' : undefined}
              value={draft.fields[field.key] ?? ''}
              onChange={(value) => setField(field.key, value)}
              placeholder={field.secret ? t('aiRating.secretPlaceholder') : ''}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}

AiProviderEditor.displayName = 'AiProviderEditor';
