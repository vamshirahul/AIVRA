"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useDemoSession } from "../demo-session-provider";
import { currentConfirmedApplications, prepareApplicationPublication, PUBLICATION_MESSAGES } from "../../lib/data-mapper/publish-applications";
import type { PublicationResult, PublicationToken } from "../../lib/data-mapper/publish-applications";
import type { MappingDraft } from "../../lib/data-mapper/column-mapping";
import type { CSVDraft, CSVSide } from "../../lib/data-mapper/parse-csv";

export function PublishApplications({ side, source, mapping, active }: { side: CSVSide; source: CSVDraft; mapping: MappingDraft; active: boolean }) {
  const { session, publishApplications } = useDemoSession();
  const [review, setReview] = useState<{ expected: PublicationToken; source: CSVDraft; confirmed: MappingDraft["confirmed"] } | null>(null);
  const [notice, setNotice] = useState<PublicationResult | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), publishButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  const id = useId(), title = side === "buyer" ? "Buyer" : "Target";
  const candidate = useMemo(() => currentConfirmedApplications(source, mapping, side), [source, mapping, side]);
  const proposed = useMemo(() => session && candidate.ok ? prepareApplicationPublication(session.current_deal, side, candidate.applications) : null, [session, candidate, side]);
  const reviewCurrent = !!session && active && !!review && review.source === source && review.confirmed === mapping.confirmed &&
    review.expected.session_id === session.session_id && review.expected.session_revision === session.session_revision;
  useEffect(() => { if (!active) { setReview(null); setNotice(null); } }, [active]);
  useEffect(() => { if (reviewCurrent) (proposed?.ok ? publishButton : cancelButton).current?.focus(); }, [reviewCurrent, proposed?.ok]);
  if (!session) return null;
  const block = !candidate.ok ? candidate : proposed && !proposed.ok ? proposed : null;
  function cancel() { setReview(null); trigger.current?.focus(); }
  function commit() {
    if (!reviewCurrent || !review) { setNotice({ ok: false, code: "stale_session" }); return; }
    // Revalidate from current CSV/mapping props at the actual click; retained rows are not authority.
    const current = currentConfirmedApplications(source, mapping, side);
    if (!current.ok) { setNotice(current); return; }
    const result = publishApplications(side, current.applications, review.expected);
    setNotice(result); setReview(null); trigger.current?.focus();
  }
  const visibleSuccess = notice?.ok && notice.session_id === session.session_id && notice.source_revision === session.input_revisions.applications;
  return <div className="publication" aria-label={`${title} application publication`}>
    <h4 className="section-title">Publish confirmed applications</h4>
    <p>Replace only the {title} inventory in this browser's demo session. License and TSA records must remain intact. No AI is run.</p>
    {block && <p className="publication-block" role="status">{PUBLICATION_MESSAGES[block.code]}
      {block.collisions !== undefined && ` Conflicting IDs: ${block.collisions}.`}
      {block.licenses !== undefined && ` Affected license records: ${block.licenses}; TSA records: ${block.tsa ?? 0}.`}</p>}
    <button ref={trigger} type="button" className="button button-secondary publication-review" disabled={!candidate.ok}
      onClick={() => { setNotice(null); setReview({ expected: { session_id: session.session_id, session_revision: session.session_revision }, source, confirmed: mapping.confirmed }); }}>Review publication</button>
    {review && !reviewCurrent && <p role="status">Review expired: the session or draft changed. Review publication again before proceeding.</p>}
    {reviewCurrent && <div className="publication-impact" role="group" aria-labelledby={`${id}-review`}>
      <h5 id={`${id}-review`}>Review {title} replacement</h5>
      {proposed?.impact && <dl>
        <div><dt>Current applications</dt><dd>{proposed.impact.current_count}</dd></div>
        <div><dt>Proposed applications</dt><dd>{proposed.impact.proposed_count}</dd></div>
        <div><dt>IDs added</dt><dd>{proposed.impact.added}</dd></div>
        <div><dt>IDs removed</dt><dd>{proposed.impact.removed}</dd></div>
        <div><dt>IDs retained</dt><dd>{proposed.impact.retained}</dd></div>
      </dl>}
      <p id={`${id}-guidance`}>{proposed?.ok ? proposed.no_op ? "No changes to publish. The source revision will remain unchanged." : "Publication replaces this side only and marks application-dependent result metadata outdated. Fixture dataset version remains unchanged." : "Publication is blocked. Supply a compatible inventory; linked records will not be repaired or deleted."}</p>
      <div className="publication-actions">
        <button ref={publishButton} type="button" className="button button-primary publication-submit" disabled={!candidate.ok || !proposed?.ok} aria-describedby={`${id}-guidance`} onClick={commit}>Publish to demo session</button>
        <button ref={cancelButton} type="button" className="button button-secondary publication-cancel" onClick={cancel}>Cancel</button>
      </div>
    </div>}
    {visibleSuccess && <p className="publication-success" role="status">{notice.changed ? `${title} applications published to this demo session. Application source revision ${notice.source_revision}.` : `No changes to publish. Application source revision ${notice.source_revision} is unchanged.`}</p>}
    {notice && !notice.ok && <p className="publication-block" role="alert">{PUBLICATION_MESSAGES[notice.code]}</p>}
  </div>;
}
