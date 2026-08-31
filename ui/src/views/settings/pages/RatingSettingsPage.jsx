/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Banner, Button, Empty, Input, Modal, Popconfirm, Select, Table, TextArea, Toast } from '@douyinfe/semi-ui-19';
import { IconDelete, IconEdit, IconPlusCircle } from '@douyinfe/semi-icons';

import { SegmentPart } from '../../../components/segment/SegmentPart';
import AiProviderEditor from './components/AiProviderEditor.jsx';
import { useActions, useSelector } from '../../../services/state/store';
import { errorMessage } from '../../../services/xhr';
import { useTranslation } from '../../../services/i18n/i18n.jsx';

/**
 * Where a user connects their own AI (Anthropic or an OpenAI-compatible provider) and writes the
 * instructions Fredy rates listings with, for the "Rate with my AI" button - the friend-facing
 * counterpart to the admin-only, Claude-Code-based rater: a plain API call to a key this person
 * owns, never anything agentic, so this page (unlike Connections) is open to every user, not just
 * an admin.
 *
 * @returns {React.ReactElement}
 */
export default function RatingSettingsPage() {
  const t = useTranslation();
  const actions = useActions();
  const providers = useSelector((state) => state.aiProviders.providers);
  const types = useSelector((state) => state.aiProviders.types);
  const ratingSettings = useSelector((state) => state.ratingSettings);

  const [editor, setEditor] = useState(null);
  const [pickingType, setPickingType] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => {
    actions.aiProviders.getTypes();
    actions.aiProviders.getProviders();
    actions.ratingSettings.getRatingSettings();
  }, [actions]);

  // Only re-seed the drafts from the server once it has actually answered - overwriting whatever
  // the user is mid-typing every time this component re-renders would make the textarea unusable.
  // Deliberately keyed on `loaded` alone, not the values themselves: this must fire once when they
  // first arrive, not again on every subsequent change (e.g. a save from this same page).
  useEffect(() => {
    if (!ratingSettings.loaded) return;
    setInstructionsDraft(ratingSettings.instructions ?? '');
    setModelDraft(ratingSettings.model ?? '');
  }, [ratingSettings.loaded]);

  const remove = async (provider) => {
    try {
      await actions.aiProviders.removeProvider(provider.id);
      Toast.success(t('aiRating.providerDeleted'));
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    }
  };

  const selectActiveProvider = async (aiAdapterId) => {
    setSavingProvider(true);
    try {
      await actions.ratingSettings.saveRatingSettings({
        aiAdapterId,
        model: modelDraft || null,
        instructions: instructionsDraft,
      });
      Toast.success(t('aiRating.settingsSaved'));
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    } finally {
      setSavingProvider(false);
    }
  };

  const saveInstructions = async () => {
    setSavingInstructions(true);
    try {
      await actions.ratingSettings.saveRatingSettings({
        aiAdapterId: ratingSettings.aiAdapterId,
        model: modelDraft || null,
        instructions: instructionsDraft,
      });
      Toast.success(t('aiRating.settingsSaved'));
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    } finally {
      setSavingInstructions(false);
    }
  };

  const resetInstructions = async () => {
    setSavingInstructions(true);
    try {
      const response = await actions.ratingSettings.saveRatingSettings({
        aiAdapterId: ratingSettings.aiAdapterId,
        model: modelDraft || null,
        instructions: null,
      });
      setInstructionsDraft(response?.instructions ?? '');
      Toast.success(t('aiRating.instructionsReset'));
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    } finally {
      setSavingInstructions(false);
    }
  };

  const providerColumns = [
    { title: t('aiRating.columnName'), dataIndex: 'name' },
    {
      title: t('aiRating.columnType'),
      dataIndex: 'adapterId',
      render: (adapterId) => types.find((type) => type.id === adapterId)?.name ?? adapterId,
    },
    {
      title: '',
      dataIndex: 'id',
      render: (id, provider) => (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            size="small"
            icon={<IconEdit />}
            onClick={() => setEditor({ mode: 'edit', providerId: id })}
            disabled={!provider.canEdit}
          >
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('aiRating.deleteConfirmTitle')}
            content={t('aiRating.deleteConfirmText')}
            okType="danger"
            onConfirm={() => remove(provider)}
          >
            <Button size="small" type="danger" icon={<IconDelete />} disabled={!provider.canEdit}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const providerOptions = providers.map((provider) => ({ value: provider.id, label: provider.name }));

  return (
    <div className="settingsShell__page">
      <SegmentPart name={t('aiRating.providersTitle')} helpText={t('aiRating.providersHelp')}>
        <Button
          type="primary"
          icon={<IconPlusCircle />}
          style={{ marginBottom: '1rem' }}
          onClick={() => setPickingType(true)}
        >
          {t('aiRating.addProvider')}
        </Button>
        <Table
          pagination={false}
          rowKey="id"
          empty={<Empty description={t('aiRating.noProviders')} />}
          columns={providerColumns}
          dataSource={providers}
        />
      </SegmentPart>

      <SegmentPart name={t('aiRating.instructionsTitle')} helpText={t('aiRating.instructionsHelp')}>
        {providers.length === 0 ? (
          <Banner fullMode={false} type="info" closeIcon={null} description={t('aiRating.noProvidersBanner')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label>{t('aiRating.activeProviderLabel')}</label>
              <Select
                style={{ width: '100%' }}
                placeholder={t('aiRating.activeProviderPlaceholder')}
                value={ratingSettings.aiAdapterId ?? undefined}
                optionList={providerOptions}
                loading={savingProvider}
                onChange={selectActiveProvider}
              />
            </div>
            <div>
              <label>{t('aiRating.modelLabel')}</label>
              <Input value={modelDraft} onChange={setModelDraft} placeholder={t('aiRating.modelPlaceholder')} />
            </div>
            <div>
              <label>{t('aiRating.instructionsLabel')}</label>
              {ratingSettings.isCustomized && (
                <Banner
                  fullMode={false}
                  type="info"
                  closeIcon={null}
                  description={t('aiRating.customizedBanner')}
                  style={{ marginBottom: '0.5rem' }}
                />
              )}
              <TextArea
                value={instructionsDraft}
                onChange={setInstructionsDraft}
                rows={20}
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button loading={savingInstructions} onClick={resetInstructions}>
                {t('aiRating.resetToDefault')}
              </Button>
              <Button theme="solid" type="primary" loading={savingInstructions} onClick={saveInstructions}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </SegmentPart>

      {editor != null && (
        <AiProviderEditor
          visible
          mode={editor.mode}
          providerId={editor.providerId}
          adapterId={editor.adapterId}
          onClose={() => setEditor(null)}
        />
      )}

      {/* Choosing the type is its own step, same reasoning as NotificationsPage's picker: the
          stored fields only make sense for one adapter type, fixed at creation. */}
      <Modal
        title={t('aiRating.addProviderPickType')}
        visible={pickingType}
        onCancel={() => setPickingType(false)}
        footer={null}
      >
        <Select
          filter
          style={{ width: '100%' }}
          placeholder={t('aiRating.addProviderPickTypePlaceholder')}
          optionList={types.map((type) => ({ value: type.id, label: type.name }))}
          onChange={(adapterId) => {
            setPickingType(false);
            setEditor({ mode: 'create', adapterId });
          }}
        />
      </Modal>
    </div>
  );
}

RatingSettingsPage.displayName = 'RatingSettingsPage';
