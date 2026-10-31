"use client";

import { useEffect, useRef, useState } from "react";
import { useDemoSession } from "./demo-session-provider";

export function DemoSessionControls() {
  const { ready, storageAvailable, recovered, resetDemoSession } = useDemoSession();
  const [confirming, setConfirming] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  function finish(reset: boolean) {
    if (reset) resetDemoSession();
    setConfirming(false);
    requestAnimationFrame(() => resetButton.current?.focus());
  }
  return (
    <div className="page-container session-controls" data-session-ready={ready}>
      <div className="session-status" role="status">
        {!ready ? "Preparing synthetic demo session…" : storageAvailable ? "Synthetic demo · Saved for this tab" : "Synthetic demo · In-memory session. Changes may be lost on refresh."}
        {recovered && <p>The saved demo session could not be restored. The original synthetic example has been loaded.</p>}
      </div>
      {!confirming ? <button type="button" ref={resetButton} className="button button-secondary" disabled={!ready} onClick={() => setConfirming(true)}>Reset demo session</button> : (
        <div className="session-confirmation" role="group" aria-labelledby="reset-session-prompt">
          <p id="reset-session-prompt">Reset to the original synthetic deal? This discards session edits and analysis metadata.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" ref={confirmButton} className="button button-primary" onClick={() => finish(true)}>Confirm reset</button>
            <button type="button" className="button button-secondary" onClick={() => finish(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
