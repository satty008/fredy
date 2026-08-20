/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useState } from 'react';
import { Button, InputNumber, Popover, Typography } from '@douyinfe/semi-ui-19';
import { IconEdit } from '@douyinfe/semi-icons';

import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';
import { formatEuro } from '../../../components/cards/chartTheme.js';
import './ColdRentOverrideEditor.less';

/**
 * Overrule rent-data.json's rent-per-m² lookup for one listing with a monthly cold rent the user
 * typed in themselves.
 *
 * Exists because that lookup matches city/district names against scraped address and title text,
 * and two portals can describe the same real flat in a way that sends the lookup down two
 * different branches - the yield and IC verdict then disagree about the same listing, and nothing
 * about rent-data.json itself is wrong in that case. Whoever is looking at the actual listing
 * (and comps) can say what the cold rent really is.
 *
 * @param {Object} props
 * @param {number|null} [props.currentOverride] - `cold_rent_override` on the listing, if set.
 * @param {(coldRent: number|null) => Promise<void>} props.onSave - Called with a number to set the
 *   override, or `null` to clear it.
 */
export default function ColdRentOverrideEditor({ currentOverride = null, onSave }) {
  const t = useTranslation();
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState(currentOverride);
  const [saving, setSaving] = useState(false);

  const open = useCallback(() => {
    setValue(currentOverride);
    setVisible(true);
  }, [currentOverride]);

  const submit = useCallback(
    async (next) => {
      setSaving(true);
      try {
        await onSave(next);
        setVisible(false);
      } finally {
        setSaving(false);
      }
    },
    [onSave],
  );

  const content = (
    <div className="coldRentOverrideEditor">
      <header className="coldRentOverrideEditor__header">
        <Typography.Title heading={6} className="coldRentOverrideEditor__title">
          {t('listing.detail.editColdRent')}
        </Typography.Title>
        <Typography.Paragraph type="tertiary" size="small" className="coldRentOverrideEditor__hint">
          {t('listing.detail.editColdRentHint')}
        </Typography.Paragraph>
      </header>

      <InputNumber
        value={value ?? undefined}
        onChange={setValue}
        min={0}
        step={10}
        suffix="EUR/mo"
        placeholder={t('listing.detail.coldRentOverridePlaceholder')}
        style={{ width: '100%' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value != null) {
            event.preventDefault();
            submit(value);
          }
        }}
      />

      {currentOverride != null && (
        <Typography.Text type="tertiary" size="small">
          {t('listing.detail.coldRentOverrideActive', { value: formatEuro(currentOverride, locale) })}
        </Typography.Text>
      )}

      <footer className="coldRentOverrideEditor__actions">
        <Button theme="borderless" onClick={() => setVisible(false)}>
          {t('common.cancel')}
        </Button>
        <div className="coldRentOverrideEditor__buttons">
          {currentOverride != null && (
            <Button theme="borderless" type="danger" loading={saving} onClick={() => submit(null)}>
              {t('listing.detail.coldRentOverrideClear')}
            </Button>
          )}
          <Button theme="solid" type="primary" loading={saving} disabled={value == null} onClick={() => submit(value)}>
            {t('listing.detail.coldRentOverrideSave')}
          </Button>
        </div>
      </footer>
    </div>
  );

  return (
    <Popover
      trigger="click"
      position="bottomLeft"
      visible={visible}
      onVisibleChange={(next) => (next ? open() : setVisible(false))}
      content={content}
    >
      <Button
        size="small"
        theme="borderless"
        icon={<IconEdit />}
        aria-label={t('listing.detail.editColdRent')}
        className="coldRentOverrideEditor__trigger"
      />
    </Popover>
  );
}
