import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
    cancelCapture,
    captureActive,
    lastCaptureResult,
    pauseCapture,
    readCaptureStatus,
    resumeCapture,
    stopCapture,
} from '../../engine/capture';
import { useEngineValue, useSampledValue } from '../../engine/hooks';
import { formatClock } from '../../lib/capture';
import { restoreInterface } from '../../state/capture-actions';
import { useCaptureSettings } from '../../state/capture-settings';

function CaptureProgress() {
    const status = useSampledValue(readCaptureStatus);
    const label = useCaptureSettings((state) => state.label);
    const percent = Math.round(
        (status.finalizing ? Math.max(status.finalizingProgress, 0) : status.progress) * 100,
    );

    let title: string;
    if (status.live) title = status.paused ? 'Recording paused' : 'Recording';
    else if (status.finalizing) title = 'Finishing the video';
    else title = status.paused ? 'Render paused' : 'Rendering';

    let detail = '';
    if (status.finalizing) detail = 'Encoding the last frames';
    else if (!status.live) {
        const done = status.framesDone.toLocaleString('en-US');
        const left = status.etaSeconds >= 0 ? ` · ${formatClock(status.etaSeconds)} left` : '';
        detail =
            status.framesTotal > 0
                ? `${done} / ${status.framesTotal.toLocaleString('en-US')} frames${left}`
                : `${done} frames`;
    }

    return (
        <section className="capture-progress bh-ui" aria-label="Capture progress">
            <p className="sr-only" role="status">
                {title}
            </p>
            <div className="capture-progress-head">
                <span
                    className="capture-progress-dot"
                    data-paused={status.paused}
                    aria-hidden="true"
                />
                <span className="capture-progress-title">{title}</span>
                <span className="num">
                    {status.live ? formatClock(status.elapsedSeconds) : `${percent}%`}
                </span>
            </div>
            {label ? <p className="capture-progress-label">{label}</p> : null}
            {status.live ? null : (
                <div
                    className="capture-progress-bar"
                    role="progressbar"
                    aria-label="Render progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                >
                    <span style={{ width: `${percent}%` }} />
                </div>
            )}
            <div className="capture-progress-foot">
                {detail ? <span className="num capture-progress-detail">{detail}</span> : null}
                {status.finalizing ? null : (
                    <div className="capture-progress-actions">
                        <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => (status.paused ? resumeCapture() : pauseCapture())}
                        >
                            {status.paused ? 'Resume' : 'Pause'}
                        </button>
                        {status.live ? (
                            <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => stopCapture()}
                            >
                                Stop and save
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => cancelCapture()}
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

const RESULT_TEXT = {
    saved: 'Video saved',
    cancelled: 'Capture cancelled; nothing was saved',
};

// Shows the progress panel while a capture runs, reports how it ended and brings the interface
// back if the capture hid it.
export function CaptureMonitor() {
    const active = useEngineValue(captureActive);
    const resultId = useEngineValue(() => lastCaptureResult()?.id ?? 0);
    const seen = useRef(resultId);
    useEffect(() => {
        if (resultId === seen.current) return;
        seen.current = resultId;
        const result = lastCaptureResult();
        if (!result) return;
        restoreInterface();
        if (result.status === 'failed') {
            toast.error(`The capture failed: ${result.message}`, { id: 'capture' });
        } else {
            toast(RESULT_TEXT[result.status], { id: 'capture' });
        }
    }, [resultId]);
    return active ? <CaptureProgress /> : null;
}
