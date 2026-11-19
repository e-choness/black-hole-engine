import { useRef } from 'react';
import {
    currentMode,
    engineObserver,
    params,
    readDive,
    readHover,
    type DivePhase,
    type HoverPhase,
} from '../engine/engine';
import { useClockSampler } from '../engine/clock';
import { useEngineValue } from '../engine/hooks';
import { useFrameSampler } from '../engine/telemetry';
import {
    MINUS,
    MISSING,
    formatClockReading,
    formatLength,
    formatNumber,
    formatSpeed,
} from '../lib/units';

const STANDARD_GRAVITY = 9.80665;
const SPEED_OF_LIGHT = 299792458;

type Tone = 'calm' | 'warn' | 'danger';

const DIVE_STATUS: Record<DivePhase, [string, Tone]> = {
    ready: ['Ready to fall', 'calm'],
    paused: ['Paused', 'calm'],
    approaching: ['Approaching the horizon', 'calm'],
    'near-horizon': ['Near the event horizon', 'warn'],
    inside: ['Inside the event horizon', 'danger'],
    'near-singularity': ['Approaching the singularity', 'danger'],
    singularity: ['Singularity reached', 'danger'],
    'inner-horizon': ['Inner horizon reached', 'danger'],
};

const HOVER_STATUS: Record<HoverPhase, [string, Tone]> = {
    ready: ['Ready to descend', 'calm'],
    minimum: ['Minimum hover radius', 'warn'],
    paused: ['Hovering', 'calm'],
    descending: ['Descending · mild blueshift', 'calm'],
    strong: ['Strong blueshift', 'warn'],
    extreme: ['Extreme blueshift', 'danger'],
};

const AXES = [
    { name: 'X', index: 0 },
    { name: 'Y', index: 1 },
    { name: 'Z', index: 2 },
];

// World axes in camera space, drawn back to front; axes pointing away from the viewer are dimmed.
function Gizmo() {
    const svgRef = useRef<SVGSVGElement>(null);
    useFrameSampler(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const e = engineObserver().orientation.elements;
        const axes = AXES.map((axis) => ({
            index: axis.index,
            x: e[axis.index],
            y: -e[axis.index + 3],
            depth: e[axis.index + 6],
        })).sort((a, b) => a.depth - b.depth);
        for (const axis of axes) {
            const group = svg.querySelector<SVGGElement>(`[data-axis="${axis.index}"]`);
            if (!group) continue;
            const [line, label] = group.children;
            line.setAttribute('x2', (axis.x * 14).toFixed(2));
            line.setAttribute('y2', (axis.y * 14).toFixed(2));
            label.setAttribute('x', (axis.x * 19).toFixed(2));
            label.setAttribute('y', (axis.y * 19 + 2.5).toFixed(2));
            group.style.opacity = axis.depth > 0 ? '1' : '0.4';
            svg.appendChild(group);
        }
    });
    return (
        <svg
            ref={svgRef}
            className="gizmo"
            viewBox="-22 -22 44 44"
            role="img"
            aria-label="Orientation of the X, Y and Z axes"
        >
            {AXES.map((axis) => (
                <g key={axis.name} data-axis={axis.index} className={`gizmo-${axis.name}`}>
                    <line x1="0" y1="0" x2="0" y2="0" />
                    <text textAnchor="middle">{axis.name}</text>
                </g>
            ))}
        </svg>
    );
}

function Readout({
    label,
    valueRef,
    className = '',
}: {
    label: React.ReactNode;
    valueRef: React.RefObject<HTMLElement | null>;
    className?: string;
}) {
    return (
        <div className="hud-cell">
            <dt>{label}</dt>
            <dd className={`num ${className}`} ref={valueRef as React.RefObject<HTMLElement>}>
                {MISSING}
            </dd>
        </div>
    );
}

export function Hud() {
    const mode = useEngineValue(currentMode);
    const orbiting = useEngineValue(() => params().observer.motion);
    const distanceRef = useRef<HTMLElement>(null);
    const physicalRef = useRef<HTMLElement>(null);
    const speedRef = useRef<HTMLElement>(null);
    const redshiftRef = useRef<HTMLElement>(null);
    const extraRef = useRef<HTMLElement>(null);
    const extra2Ref = useRef<HTMLElement>(null);
    const extra2LabelRef = useRef<HTMLSpanElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);

    useClockSampler(({ reading, scale }) => {
        const text = formatClockReading(reading, scale);
        const set = (ref: React.RefObject<HTMLElement | null>, value: string) => {
            if (ref.current && ref.current.textContent !== value) ref.current.textContent = value;
        };
        set(distanceRef, `${formatNumber(reading.r, { decimals: reading.r < 10 ? 2 : 1 })} r_s`);
        set(physicalRef, formatLength(scale.toMeters(reading.r, 'rs')));
        const speed = reading.speed === null ? null : formatSpeed(reading.speed, { decimals: 3 });
        set(speedRef, speed === null ? MISSING : `${speed} · γ ${text.lorentzFactor}`);
        set(redshiftRef, reading.redshift === null ? MISSING : `z ${text.gravitationalRedshift}`);

        let status: [string, Tone] | null = null;
        if (mode === 'dive') {
            const dive = readDive();
            status = DIVE_STATUS[dive.phase];
            set(extraRef, `${MINUS}${formatNumber(dive.rate, { decimals: 3 })} c`);
            const outside = reading.t !== null;
            const target = dive.spinning ? 'inner horizon' : 'singularity';
            if (extra2LabelRef.current) {
                extra2LabelRef.current.textContent = outside ? 'τ to horizon' : `τ to ${target}`;
            }
            set(
                extra2Ref,
                (outside ? text.properTimeToHorizon : text.properTimeRemaining) ?? MISSING,
            );
        } else if (mode === 'hover') {
            const hover = readHover();
            status = HOVER_STATUS[hover.phase];
            set(extraRef, `${formatNumber(hover.blueshift, { decimals: 2 })}×`);
            const acceleration =
                (hover.acceleration * SPEED_OF_LIGHT ** 2) / scale.schwarzschildRadius;
            set(extra2Ref, `${formatNumber(acceleration / STANDARD_GRAVITY, { digits: 3 })} g`);
        }
        const node = statusRef.current;
        if (node && status) {
            if (node.textContent !== status[0]) node.textContent = status[0];
            node.dataset.tone = status[1];
        }
    });

    const title =
        mode === 'dive'
            ? 'Observer · free fall'
            : mode === 'hover'
              ? 'Observer · hovering'
              : orbiting
                ? 'Observer · circular orbit'
                : 'Observer · at rest';

    return (
        <section className="hud glass" aria-label="Observer readouts">
            <div className="hud-head">
                <span className="caps-label">{title}</span>
                <Gizmo />
            </div>
            <dl className="hud-grid">
                <Readout label="Distance r" valueRef={distanceRef} />
                <Readout label="Physical" valueRef={physicalRef} />
                <Readout label="Speed" valueRef={speedRef} />
                <Readout label="Grav. redshift" valueRef={redshiftRef} className="hud-redshift" />
                {mode === 'dive' && (
                    <>
                        <Readout label="Fall rate dr/dτ" valueRef={extraRef} />
                        <Readout
                            label={<span ref={extra2LabelRef}>τ to horizon</span>}
                            valueRef={extra2Ref}
                        />
                    </>
                )}
                {mode === 'hover' && (
                    <>
                        <Readout label="Blueshift of starlight" valueRef={extraRef} />
                        <Readout label="Thrust needed" valueRef={extra2Ref} />
                    </>
                )}
            </dl>
            {mode !== 'orbit' && <p className="hud-status" role="status" ref={statusRef} />}
        </section>
    );
}
