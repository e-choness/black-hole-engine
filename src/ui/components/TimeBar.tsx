import { useEffect, useRef } from 'react';
import { DropdownMenu, Slider } from 'radix-ui';
import { Check, Circle, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from 'lucide-react';
import { toast } from 'sonner';
import {
    currentMode,
    params,
    playbackSpeed,
    readDive,
    readHover,
    restartScenario,
    setPlaybackSpeed,
    timelineCapture,
    toggleTimelineCapture,
} from '../engine/engine';
import { useClockSampler } from '../engine/clock';
import { useEngineValue, useSampledValue } from '../engine/hooks';
import {
    SPEEDS,
    isPlaying,
    scenarioProgress,
    seekScenario,
    stepPlayback,
    togglePlayback,
} from '../engine/playback';
import { createMassScale, formatClockReading, formatDuration } from '../lib/units';
import { portalContainer } from '../lib/portal';

type Scenario = 'dive' | 'hover';

const SCENARIO_NOUN: Record<Scenario, string> = { dive: 'dive', hover: 'hover' };
const PROGRESS_STEPS = 1000;
const HORIZON_EVENTS: Record<string, string> = {
    'crossed-horizon': 'Crossed the event horizon: no distant clock will ever see this moment',
    'reached-inner-horizon': 'Reached the inner horizon',
    'reached-singularity': 'Reached the singularity',
};

// Simulated time per second of wall-clock time at `speed`, from the light-crossing time r_s/c of
// the current mass.
function speedEquivalent(speed: number, massSolar: number): string {
    return formatDuration(createMassScale({ massSolar }).toSeconds(speed, 'rs'));
}

function SpeedMenu() {
    const speed = useEngineValue(playbackSpeed);
    const massSolar = useEngineValue(() => params().disk.mass_msun);
    const equivalent = speedEquivalent(speed, massSolar);
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="speed-btn">
                <span className="sr-only">Simulation speed </span>
                <span className="num">× {speed}</span>
                <span className="speed-equivalent">1 s ≙ {equivalent}</span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={portalContainer()}>
                <DropdownMenu.Content
                    className="popover speed-menu bh-ui"
                    side="top"
                    sideOffset={10}
                    align="start"
                >
                    <DropdownMenu.Label className="caps-label menu-label">
                        Simulation speed
                    </DropdownMenu.Label>
                    <DropdownMenu.RadioGroup
                        value={String(speed)}
                        onValueChange={(value) => setPlaybackSpeed(Number(value))}
                    >
                        {SPEEDS.map((option) => (
                            <DropdownMenu.RadioItem
                                key={option}
                                value={String(option)}
                                className="menu-item speed-item"
                            >
                                <span className="num">× {option}</span>
                                <span className="speed-equivalent">
                                    1 s ≙ {speedEquivalent(option, massSolar)}
                                </span>
                                <DropdownMenu.ItemIndicator className="menu-item-check">
                                    <Check size={14} aria-hidden="true" />
                                </DropdownMenu.ItemIndicator>
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

function TimelineCaptureButton({ mode }: { mode: Scenario }) {
    const recording = useSampledValue(
        () => timelineCapture.active && timelineCapture.mode === mode,
    );
    const wasRecording = useRef(recording);
    useEffect(() => {
        const feedback = timelineCapture.feedback[mode];
        if (wasRecording.current && !recording && feedback) {
            if (feedback.tone === 'is-warning') toast.error(feedback.text, { id: 'capture' });
            else toast.success(`Timeline: ${feedback.text}`, { id: 'capture' });
        }
        wasRecording.current = recording;
    }, [mode, recording]);
    const toggle = () => {
        toggleTimelineCapture(mode);
        const feedback = timelineCapture.feedback[mode];
        if (feedback?.tone === 'is-warning') toast.error(feedback.text, { id: 'capture' });
    };
    const noun = SCENARIO_NOUN[mode];
    return (
        <button
            type="button"
            className="icon-btn capture-btn"
            aria-pressed={recording}
            aria-label={
                recording
                    ? 'Stop recording and save to the timeline'
                    : `Record ${noun} to the timeline`
            }
            title={
                recording
                    ? 'Stop and save to the timeline'
                    : `Record the ${noun} and camera moves into the timeline`
            }
            onClick={toggle}
        >
            {recording ? (
                <Square size={12} aria-hidden="true" fill="currentColor" />
            ) : (
                <Circle size={12} aria-hidden="true" fill="currentColor" />
            )}
        </button>
    );
}

function ScenarioControls({ mode }: { mode: Scenario }) {
    const progress = useSampledValue(() => Math.round(scenarioProgress(mode) * PROGRESS_STEPS));
    const radius = useSampledValue(() => (mode === 'dive' ? readDive() : readHover()).r.toFixed(2));
    const noun = SCENARIO_NOUN[mode];
    return (
        <div className="timebar-scenario">
            <button
                type="button"
                className="icon-btn"
                aria-label={`Restart ${noun}`}
                title={`Restart ${noun}`}
                onClick={() => restartScenario(mode)}
            >
                <RotateCcw size={16} aria-hidden="true" />
            </button>
            <Slider.Root
                className="slider timebar-progress"
                min={0}
                max={PROGRESS_STEPS}
                step={1}
                value={[progress]}
                onValueChange={([value]) => seekScenario(mode, value / PROGRESS_STEPS)}
            >
                <Slider.Track className="slider-track">
                    <Slider.Range className="slider-range" />
                </Slider.Track>
                <Slider.Thumb
                    className="slider-thumb"
                    aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} progress`}
                    aria-valuetext={`r = ${radius} Schwarzschild radii`}
                />
            </Slider.Root>
            <TimelineCaptureButton mode={mode} />
        </div>
    );
}

function Clocks() {
    const tRef = useRef<HTMLSpanElement>(null);
    const tNoteRef = useRef<HTMLSpanElement>(null);
    const tauRef = useRef<HTMLSpanElement>(null);
    const rateRef = useRef<HTMLSpanElement>(null);
    const barRef = useRef<HTMLSpanElement>(null);
    useClockSampler(({ reading, scale }) => {
        if (!tRef.current || !tNoteRef.current || !tauRef.current || !rateRef.current) return;
        const text = formatClockReading(reading, scale);
        tRef.current.textContent = text.t;
        tNoteRef.current.textContent = reading.t === null ? 'inside horizon' : '';
        tauRef.current.textContent = text.tau;
        rateRef.current.textContent = text.dTauDt;
        if (barRef.current) {
            const rate = reading.dTauDt === null ? 0 : Math.max(0, Math.min(1, reading.dTauDt));
            barRef.current.style.width = `${rate * 100}%`;
        }
        const event = reading.events.find((name) => name in HORIZON_EVENTS);
        if (event) toast(HORIZON_EVENTS[event], { id: 'horizon' });
    });
    return (
        <>
            <div className="clock">
                <span className="clock-label">
                    Distant clock t <span className="clock-note" ref={tNoteRef} />
                </span>
                <span className="num clock-value" ref={tRef}>
                    –
                </span>
            </div>
            <div className="clock">
                <span className="clock-label">Your clock τ</span>
                <span className="num clock-value clock-value--own" ref={tauRef}>
                    –
                </span>
            </div>
            <div className="clock clock--rate">
                <span className="clock-label">
                    dτ/dt{' '}
                    <span className="num clock-rate" ref={rateRef}>
                        –
                    </span>
                </span>
                <span className="clock-bar" aria-hidden="true">
                    <span ref={barRef} />
                </span>
            </div>
        </>
    );
}

export function TimeBar() {
    const mode = useEngineValue(currentMode);
    const playing = useSampledValue(() => isPlaying());
    const target = mode === 'orbit' ? 'simulation' : SCENARIO_NOUN[mode];
    const stepUnit = mode === 'orbit' ? 'one light-crossing time' : 'two percent';
    return (
        <div className="timebar glass" role="group" aria-label="Time controls">
            <button
                type="button"
                className="icon-btn"
                aria-label={`Step back ${stepUnit}`}
                title="Step back"
                onClick={() => stepPlayback(-1)}
            >
                <SkipBack size={18} aria-hidden="true" />
            </button>
            <button
                type="button"
                className="play-btn"
                aria-label={`${playing ? 'Pause' : 'Play'} ${target} (Space)`}
                aria-keyshortcuts="Space"
                onClick={togglePlayback}
            >
                {playing ? (
                    <Pause size={18} aria-hidden="true" fill="currentColor" />
                ) : (
                    <Play size={18} aria-hidden="true" fill="currentColor" />
                )}
            </button>
            <button
                type="button"
                className="icon-btn"
                aria-label={`Step forward ${stepUnit}`}
                title="Step forward"
                onClick={() => stepPlayback(1)}
            >
                <SkipForward size={18} aria-hidden="true" />
            </button>
            <SpeedMenu />
            {mode !== 'orbit' && <ScenarioControls mode={mode} />}
            <span className="timebar-divider" aria-hidden="true" />
            <Clocks />
        </div>
    );
}
