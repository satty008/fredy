/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Button, Select, Tag, TextArea } from '@douyinfe/semi-ui-19';

import ImmocockpitVerdictBadge from '../../../components/listings/ImmocockpitVerdictBadge.jsx';
import PriceFactorBadge from '../../../components/listings/PriceFactorBadge.jsx';
import ColdRentOverrideEditor from './ColdRentOverrideEditor.jsx';
import AttachmentsCard from './AttachmentsCard.jsx';
import { useTranslation } from '../../../services/i18n/i18n.jsx';
import './ListingWorkspace.less';

/**
 * The half of the page the reader writes rather than reads.
 *
 * Notes and uploaded documents are the two things a person adds to a listing, they are used in the
 * same sitting, and neither came from a portal - so they share a card instead of being two
 * unrelated blocks a divider apart. Both stay visible when empty: an upload area that only appears
 * once there is something to show cannot be the place you put the first thing.
 *
 * @param {Object} props
 * @param {string} props.listingId
 * @param {string} props.notesDraft
 * @param {(value: string) => void} props.onNotesChange
 * @param {() => void} props.onSaveNotes
 * @param {boolean} props.notesSaving
 * @param {boolean} props.notesDirty - Whether the draft differs from what is stored.
 * @param {('good'|'maybe'|'bad'|null)} [props.aiVerdict] - The stored AI review verdict, if any.
 * @param {('good'|'maybe'|'bad'|null)} [props.immocockpitVerdict] - The server-computed Immocockpit verdict.
 * @param {Object|null} [props.immocockpitAnalysis] - The numbers behind it, for the tooltip.
 * @param {number|null} [props.coldRentOverride] - The user's own monthly cold rent, if set.
 * @param {(coldRent: number|null) => Promise<void>} [props.onSaveColdRentOverride]
 * @param {() => void} [props.onRateWithAi]
 * @param {boolean} [props.ratingInFlight]
 * @param {string} [props.ratingModel]
 * @param {{ value: string, label: string }[]} [props.ratingModels]
 * @param {(value: string) => void} [props.onRatingModelChange]
 * @returns {React.ReactElement}
 */
export default function ListingWorkspace({
  listingId,
  notesDraft,
  onNotesChange,
  onSaveNotes,
  notesSaving,
  notesDirty,
  aiVerdict = null,
  immocockpitVerdict = null,
  immocockpitAnalysis = null,
  coldRentOverride = null,
  onSaveColdRentOverride,
  onRateWithAi,
  ratingInFlight = false,
  ratingModel,
  ratingModels = [],
  onRatingModelChange,
}) {
  const t = useTranslation();

  return (
    <section className="listing-card listing-workspace">
      <div className="listing-workspace__head">
        <h2 className="listing-card__label">{t('listing.detail.workspaceTitle')}</h2>
        {/* The retention rule, on the label line rather than as a paragraph under the upload
            control. It is a standing fact about the feature, read once, and it does not need to
            take a line of its own every time the page opens. */}
        <span className="listing-workspace__hint">{t('listing.detail.attachmentsRetention')}</span>
      </div>

      <div className="listing-workspace__columns">
        <div className="listing-workspace__notes">
          <h3 className="listing-workspace__subtitle">{t('listing.detail.notesTitle')}</h3>
          {/* The three verdicts about this listing - the AI's reading of the text and photos, and the
              two number-only screens from immocockpit - side by side so they can be compared. */}
          <div className="listing-workspace__verdicts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {aiVerdict && (
              <Tag color={aiVerdict === 'good' ? 'green' : aiVerdict === 'maybe' ? 'amber' : 'red'} shape="circle">
                {t(`listings.filterAiVerdict${aiVerdict[0].toUpperCase()}${aiVerdict.slice(1)}`)}
              </Tag>
            )}
            <ImmocockpitVerdictBadge verdict={immocockpitVerdict} analysis={immocockpitAnalysis} />
            <PriceFactorBadge analysis={immocockpitAnalysis} />
            {onSaveColdRentOverride && (
              <ColdRentOverrideEditor currentOverride={coldRentOverride} onSave={onSaveColdRentOverride} />
            )}
          </div>
          <TextArea
            value={notesDraft}
            onChange={onNotesChange}
            placeholder={t('listing.detail.notesPlaceholder')}
            rows={5}
            autosize={{ minRows: 6, maxRows: 14 }}
            className="listing-detail__notes-textarea"
            showClear
          />
        </div>

        <div className="listing-workspace__attachments">
          <AttachmentsCard listingId={listingId} />
        </div>
      </div>

      {/* Outlined, not solid: the page has exactly one solid button and it is not this one. */}
      <div className="listing-workspace__footer">
        <Button
          className="listing-workspace__save"
          theme="outline"
          loading={notesSaving}
          disabled={notesSaving || !notesDirty}
          onClick={onSaveNotes}
        >
          {t('listing.detail.storeNotes')}
        </Button>
        {onRateWithAi && ratingModels.length > 0 && (
          <Select
            size="small"
            value={ratingModel}
            onChange={onRatingModelChange}
            disabled={ratingInFlight}
            style={{ minWidth: 130 }}
          >
            {ratingModels.map((model) => (
              <Select.Option key={model.value} value={model.value}>
                {model.label}
              </Select.Option>
            ))}
          </Select>
        )}
        {onRateWithAi && (
          <Button loading={ratingInFlight} disabled={ratingInFlight} onClick={onRateWithAi}>
            {t('listing.detail.rateWithAi')}
          </Button>
        )}
      </div>
    </section>
  );
}

ListingWorkspace.displayName = 'ListingWorkspace';
