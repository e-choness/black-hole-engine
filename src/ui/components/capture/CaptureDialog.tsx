import { useId, useMemo, useState, type ReactNode } from 'react';
import { Checkbox, Dialog, Select, Tabs, ToggleGroup } from 'radix-ui';
import { Check, ChevronDown, Clock, X } from 'lucide-react';
import {
    type TimelineSource,
    estimateVideo,
    timelineSources,
    videoFilePrefix,
} from '../../engine/capture';
import { useFrameSampler } from '../../engine/telemetry';
import {
    FRAME_RATES,
    QUALITIES,
    RESOLUTIONS,
    VIDEO_FORMATS,
    formatApproxDuration,
    formatBytes,
    formatClock,
} from '../../lib/capture';
import { portalContainer } from '../../lib/portal';
import { beginVideo, saveScreenshot } from '../../state/capture-actions';
import { type VideoSettings, useCaptureSettings } from '../../state/capture-settings';
import { type CaptureTab, useUi } from '../../state/ui-store';

interface Option {
    value: string;
    label: string;
}

function SelectField({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
}) {
    const id = useId();
    return (
        <div className="capture-field">
            <label id={`${id}-label`} htmlFor={id} className="capture-label">
                {label}
            </label>
            <Select.Root value={value} onValueChange={onChange}>
                <Select.Trigger
                    id={id}
                    className="select-trigger capture-select"
                    aria-labelledby={`${id}-label ${id}`}
                >
                    <Select.Value />
                    <Select.Icon>
                        <ChevronDown size={14} aria-hidden="true" />
                    </Select.Icon>
                </Select.Trigger>
                <Select.Portal container={portalContainer()}>
                    <Select.Content
                        className="popover select-content bh-ui"
                        position="popper"
                        sideOffset={6}
                    >
                        <Select.Viewport>
                            {options.map((option) => (
                                <Select.Item
                                    key={option.value}
                                    value={option.value}
                                    className="menu-item"
                                >
                                    <Select.ItemText>{option.label}</Select.ItemText>
                                    <Select.ItemIndicator className="menu-item-check">
                                        <Check size={14} aria-hidden="true" />
                                    </Select.ItemIndicator>
                                </Select.Item>
                            ))}
                        </Select.Viewport>
                    </Select.Content>
                </Select.Portal>
            </Select.Root>
        </div>
    );
}

function SegmentedField({
    label,
    value,
    options,
    onChange,
    wide,
    children,
}: {
    label: string;
    value: string;
    options: Option[];
    onChange: (value: string) => void;
    wide?: boolean;
    children?: ReactNode;
}) {
    const id = useId();
    return (
        <div className={wide ? 'capture-field capture-field--wide' : 'capture-field'}>
            <span id={id} className="capture-label">
                {label}
            </span>
            <ToggleGroup.Root
                type="single"
                className="segmented"
                value={value}
                aria-labelledby={id}
                onValueChange={(next) => next && onChange(next)}
            >
                {options.map((option) => (
                    <ToggleGroup.Item
                        key={option.value}
                        value={option.value}
                        className="segmented-item"
                    >
                        {option.label}
                    </ToggleGroup.Item>
                ))}
            </ToggleGroup.Root>
            {children}
        </div>
    );
}

function CheckField({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    const id = useId();
    return (
        <div className="capture-check">
            <Checkbox.Root
                id={id}
                className="checkbox"
                checked={checked}
                onCheckedChange={(next) => onChange(next === true)}
            >
                <Checkbox.Indicator>
                    <Check size={14} aria-hidden="true" />
                </Checkbox.Indicator>
            </Checkbox.Root>
            <label htmlFor={id}>{label}</label>
        </div>
    );
}

function sourceOptions(timelines: TimelineSource[]): Option[] {
    return [
        { value: 'live', label: 'Live view · real time' },
        { value: 'dive', label: 'Dive scenario · from the start' },
        ...timelines.map((source) => ({
            value: source.value,
            label: source.seconds
                ? `Timeline · ${source.name} (${formatClock(source.seconds)})`
                : `Timeline · ${source.name}`,
        })),
    ];
}

// What the progress panel says is being captured, such as "Orbit Showcase · WebM · VP9".
function sessionLabel(settings: VideoSettings, timelines: TimelineSource[]): string {
    const format = VIDEO_FORMATS.find((entry) => entry.codec === settings.codec)?.label ?? '';
    const source =
        settings.source === 'live'
            ? 'Live view'
            : settings.source === 'dive'
              ? 'Dive'
              : (timelines.find((entry) => entry.value === settings.source)?.name ?? 'Timeline');
    return `${source} · ${format}`;
}

function Estimate({ settings, frameSeconds }: { settings: VideoSettings; frameSeconds: number }) {
    const estimate = estimateVideo(settings, frameSeconds);
    let text: ReactNode;
    if (settings.source === 'live') {
        text = (
            <>
                Records the view in real time until you stop it ·{' '}
                <span className="num">≈ {formatBytes(estimate.bytes ?? 0)}</span> per minute
            </>
        );
    } else if (estimate.frames === null) {
        text = 'The length of this render cannot be estimated.';
    } else {
        text = (
            <>
                Estimated <span className="num">{estimate.frames.toLocaleString('en-US')}</span>{' '}
                frames · {formatApproxDuration(estimate.renderSeconds ?? 0)} on this device ·{' '}
                <span className="num">≈ {formatBytes(estimate.bytes ?? 0)}</span>
            </>
        );
    }
    return (
        <p className="capture-estimate">
            <Clock size={18} aria-hidden="true" />
            <span>{text}</span>
        </p>
    );
}

// Offline renders stream into a file chosen up front where the browser can save one, so long
// renders do not have to fit in memory. The picker needs the click's user activation.
async function pickVideoFile(
    settings: VideoSettings,
): Promise<FileSystemWritableFileStream | undefined | null> {
    const picker = (
        window as unknown as {
            showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
        }
    ).showSaveFilePicker;
    if (settings.source === 'live' || typeof picker !== 'function') return undefined;
    const format = VIDEO_FORMATS.find((entry) => entry.codec === settings.codec)!;
    const mimeType = format.extension === '.mp4' ? 'video/mp4' : 'video/webm';
    try {
        const handle = await picker({
            suggestedName: `${videoFilePrefix(settings)}${format.extension}`,
            types: [{ description: format.label, accept: { [mimeType]: [format.extension] } }],
        });
        return await handle.createWritable();
    } catch (error) {
        if ((error as DOMException).name === 'AbortError') return null;
        return undefined;
    }
}

function VideoForm({ onDone }: { onDone: () => void }) {
    const settings = useCaptureSettings((state) => state.video);
    const setVideo = useCaptureSettings((state) => state.setVideo);
    // The estimate follows the measured frame time, updated only when it changes noticeably.
    const [frameSeconds, setFrameSeconds] = useState(1 / 30);
    useFrameSampler((sample) => {
        if (!sample.rendering || sample.fps <= 1) return;
        const next = 1 / sample.fps;
        setFrameSeconds((previous) =>
            Math.abs(next - previous) > 0.2 * previous ? next : previous,
        );
    });
    const timelines = useMemo(() => timelineSources(), []);
    const sources = sourceOptions(timelines);
    const source = sources.some((option) => option.value === settings.source)
        ? settings.source
        : 'live';
    const current = { ...settings, source };
    const live = source === 'live';

    const start = async () => {
        const file = await pickVideoFile(current);
        if (file === null) return;
        onDone();
        await beginVideo(current, sessionLabel(current, timelines), file);
    };

    return (
        <>
            <div className="capture-grid">
                <SegmentedField
                    label="Format"
                    wide
                    value={current.codec}
                    options={VIDEO_FORMATS.map((entry) => ({
                        value: entry.codec,
                        label: entry.label,
                    }))}
                    onChange={(codec) => setVideo({ codec: codec as VideoSettings['codec'] })}
                >
                    <p className="capture-hint">
                        Encoded in the browser. MP4 plays everywhere; AV1 gives the smallest files.
                    </p>
                </SegmentedField>
                <SelectField
                    label="Resolution"
                    value={current.resolution}
                    options={RESOLUTIONS}
                    onChange={(resolution) => setVideo({ resolution })}
                />
                <SegmentedField
                    label="Frame rate"
                    value={String(current.fps)}
                    options={FRAME_RATES.map((fps) => ({ value: String(fps), label: String(fps) }))}
                    onChange={(fps) => setVideo({ fps: Number(fps) as VideoSettings['fps'] })}
                />
                <SelectField
                    label="Source"
                    value={source}
                    options={sources}
                    onChange={(next) => setVideo({ source: next })}
                />
                {live ? (
                    <p className="capture-hint capture-hint--field">
                        A live recording keeps the current render quality and frame pacing.
                    </p>
                ) : (
                    <SelectField
                        label="Render quality"
                        value={current.quality}
                        options={QUALITIES}
                        onChange={(quality) =>
                            setVideo({ quality: quality as VideoSettings['quality'] })
                        }
                    />
                )}
                <CheckField
                    label="Hide the interface while capturing"
                    checked={current.hideInterface}
                    onChange={(hideInterface) => setVideo({ hideInterface })}
                />
            </div>
            <Estimate settings={current} frameSeconds={frameSeconds} />
            <div className="capture-actions">
                <Dialog.Close className="btn btn--secondary">Cancel</Dialog.Close>
                <button type="button" className="btn btn--primary" onClick={() => void start()}>
                    <span className="record-dot" aria-hidden="true" />
                    {live ? 'Start recording' : 'Start render'}
                </button>
            </div>
        </>
    );
}

function ScreenshotForm({ onDone }: { onDone: () => void }) {
    const settings = useCaptureSettings((state) => state.screenshot);
    const setScreenshot = useCaptureSettings((state) => state.setScreenshot);
    const save = () => {
        onDone();
        saveScreenshot(settings);
    };
    return (
        <>
            <div className="capture-grid">
                <SelectField
                    label="Resolution"
                    value={settings.resolution}
                    options={RESOLUTIONS}
                    onChange={(resolution) => setScreenshot({ resolution })}
                />
                <SelectField
                    label="Render quality"
                    value={settings.quality}
                    options={QUALITIES}
                    onChange={(quality) =>
                        setScreenshot({ quality: quality as VideoSettings['quality'] })
                    }
                />
                <p className="capture-hint capture-field--wide">
                    Saved as PNG. A fixed resolution is rendered at that size; 4K at Cinematic
                    quality can take several seconds. P saves one with these settings at once.
                </p>
            </div>
            <div className="capture-actions">
                <Dialog.Close className="btn btn--secondary">Cancel</Dialog.Close>
                <button type="button" className="btn btn--primary" onClick={save}>
                    Save screenshot
                </button>
            </div>
        </>
    );
}

export function CaptureDialog() {
    const open = useUi((state) => state.captureOpen);
    const setOpen = useUi((state) => state.setCaptureOpen);
    const tab = useUi((state) => state.captureTab);
    const setTab = useUi((state) => state.setCaptureTab);
    const close = () => setOpen(false);
    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={portalContainer()}>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="capture bh-ui" aria-describedby={undefined}>
                    <div className="sheet-head">
                        <Dialog.Title className="sheet-title">Capture</Dialog.Title>
                        <Dialog.Close className="icon-btn" aria-label="Close">
                            <X size={18} aria-hidden="true" />
                        </Dialog.Close>
                    </div>
                    <Tabs.Root value={tab} onValueChange={(next) => setTab(next as CaptureTab)}>
                        <Tabs.List className="capture-tabs" aria-label="Capture type">
                            <Tabs.Trigger value="screenshot" className="inspector-tab">
                                Screenshot
                            </Tabs.Trigger>
                            <Tabs.Trigger value="video" className="inspector-tab">
                                Video
                            </Tabs.Trigger>
                        </Tabs.List>
                        <Tabs.Content value="screenshot" className="capture-panel">
                            <ScreenshotForm onDone={close} />
                        </Tabs.Content>
                        <Tabs.Content value="video" className="capture-panel">
                            <VideoForm onDone={close} />
                        </Tabs.Content>
                    </Tabs.Root>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
