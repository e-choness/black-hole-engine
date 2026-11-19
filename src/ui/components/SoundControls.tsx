import { useEffect, useId, useState } from 'react';
import { Popover, Slider, Switch } from 'radix-ui';
import { Volume2, VolumeX } from 'lucide-react';
import { portalContainer } from '../lib/portal';
import {
    playGravitationalWave,
    setSoundEnabled,
    setSoundVolume,
    setVoice,
    subscribeCaptions,
    useSound,
    VOICES,
    type SoundCaption,
    type SoundState,
    type Voice,
    type VoiceSettings,
} from '../engine/sound';

const VOICE_TEXT: Record<Voice, { title: string; summary: string }> = {
    disk: {
        title: 'Accretion disk',
        summary: 'Hiss of the hot gas and the tone of a hot spot orbiting the hole',
    },
    jet: { title: 'Jets', summary: 'Synchrotron hiss and the pulses of knots moving outwards' },
    gw: { title: 'Gravitational waves', summary: 'The hole ringing, or a merger, on demand' },
    clock: { title: 'Clocks', summary: 'High ticks: your clock. Low ticks: the distant clock' },
};

const CAPTION_COUNT = 3;

function statusText(sound: SoundState): string {
    switch (sound.status) {
        case 'running':
            return 'On';
        case 'starting':
            return 'Starting…';
        case 'suspended':
            if (sound.reason === 'hidden') return 'Paused while the page is hidden';
            if (sound.reason === 'interrupted') return 'Interrupted by the system';
            return 'Waiting for a click or tap to start';
        case 'unsupported':
            return 'This browser cannot play sound';
        case 'error':
            return sound.error ? `Could not start: ${sound.error}` : 'Could not start';
        default:
            return 'Off · the simulation makes no sound until you turn it on';
    }
}

const percent = (value: number) => `${Math.round(value * 100)} %`;

function Level({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <Slider.Root
            className="slider"
            min={0}
            max={100}
            step={1}
            value={[Math.round(value * 100)]}
            onValueChange={([position]) => onChange(position / 100)}
        >
            <Slider.Track className="slider-track">
                <Slider.Range className="slider-range" />
            </Slider.Track>
            <Slider.Thumb
                className="slider-thumb"
                aria-label={label}
                aria-valuetext={percent(value)}
            />
        </Slider.Root>
    );
}

function VoiceRow({
    voice,
    settings,
    running,
}: {
    voice: Voice;
    settings: VoiceSettings;
    running: boolean;
}) {
    const { title, summary } = VOICE_TEXT[voice];
    return (
        <li className="sound-voice">
            <div className="sound-voice-head">
                <span className="sound-voice-title">{title}</span>
                <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={`Mute ${title}`}
                    aria-pressed={settings.muted}
                    onClick={() => setVoice(voice, { muted: !settings.muted })}
                >
                    {settings.muted ? (
                        <VolumeX size={15} aria-hidden="true" />
                    ) : (
                        <Volume2 size={15} aria-hidden="true" />
                    )}
                </button>
                <button
                    type="button"
                    className="sound-solo"
                    aria-label={`Solo ${title}`}
                    aria-pressed={settings.solo}
                    onClick={() => setVoice(voice, { solo: !settings.solo })}
                >
                    Solo
                </button>
            </div>
            <Level
                label={`${title} level`}
                value={settings.level}
                onChange={(level) => setVoice(voice, { level })}
            />
            <p className="sound-voice-summary">{summary}</p>
            {voice === 'gw' && (
                <div className="sound-gw">
                    <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={!running}
                        onClick={() => playGravitationalWave('ringdown')}
                    >
                        Play ringdown
                    </button>
                    <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={!running}
                        onClick={() => playGravitationalWave('chirp')}
                    >
                        Play merger
                    </button>
                </div>
            )}
        </li>
    );
}

// What the sound describes at the moment, for those who cannot hear it.
function Captions() {
    const [captions, setCaptions] = useState<SoundCaption[]>([]);
    useEffect(
        () =>
            subscribeCaptions((caption) =>
                setCaptions((list) => [...list, caption].slice(-CAPTION_COUNT)),
            ),
        [],
    );
    return (
        <div className="sound-captions" role="log" aria-label="Sound captions">
            {captions.length === 0 ? (
                <p className="sound-empty">Captions of what you hear appear here.</p>
            ) : (
                captions.map((caption) => (
                    <p key={`${caption.key}-${caption.time}`}>{caption.text}</p>
                ))
            )}
        </div>
    );
}

function SoundPanel({ side }: { side: 'left' | 'right' }) {
    const sound = useSound();
    const titleId = useId();
    const statusId = useId();
    return (
        <Popover.Portal container={portalContainer()}>
            <Popover.Content
                className="popover sound-panel bh-ui"
                side={side}
                align="start"
                sideOffset={12}
                collisionPadding={12}
                aria-labelledby={titleId}
            >
                <div className="sound-head">
                    <h2 id={titleId} className="sound-title">
                        Sound
                    </h2>
                    <Switch.Root
                        className="switch"
                        checked={sound.enabled}
                        disabled={sound.status === 'unsupported'}
                        onCheckedChange={setSoundEnabled}
                        aria-label="Sound"
                        aria-describedby={statusId}
                    >
                        <Switch.Thumb className="switch-thumb" />
                    </Switch.Root>
                </div>
                <p id={statusId} className="sound-status" role="status">
                    {statusText(sound)}
                </p>
                <div className="sound-volume">
                    <span className="sound-voice-title" aria-hidden="true">
                        Volume
                    </span>
                    <Level label="Volume" value={sound.volume} onChange={setSoundVolume} />
                    <span className="num sound-value" aria-hidden="true">
                        {percent(sound.volume)}
                    </span>
                </div>
                <h3 className="caps-label sound-section">Voices</h3>
                <ul className="sound-voices">
                    {VOICES.map((voice) => (
                        <VoiceRow
                            key={voice}
                            voice={voice}
                            settings={sound.voices[voice]}
                            running={sound.status === 'running'}
                        />
                    ))}
                </ul>
                <Captions />
            </Popover.Content>
        </Popover.Portal>
    );
}

export function SoundRailButton() {
    const on = useSound().enabled;
    return (
        <Popover.Root>
            <Popover.Trigger className="rail-btn" data-sound={on ? 'on' : 'off'}>
                {on ? (
                    <Volume2 size={20} aria-hidden="true" />
                ) : (
                    <VolumeX size={20} aria-hidden="true" />
                )}
                Sound<span className="sr-only">{on ? ' on' : ' off'}</span>
            </Popover.Trigger>
            <SoundPanel side="right" />
        </Popover.Root>
    );
}

export function SoundFab() {
    const on = useSound().enabled;
    return (
        <Popover.Root>
            <Popover.Trigger
                className="icon-btn"
                data-sound={on ? 'on' : 'off'}
                aria-label={on ? 'Sound on' : 'Sound off'}
            >
                {on ? (
                    <Volume2 size={18} aria-hidden="true" />
                ) : (
                    <VolumeX size={18} aria-hidden="true" />
                )}
            </Popover.Trigger>
            <SoundPanel side="left" />
        </Popover.Root>
    );
}
