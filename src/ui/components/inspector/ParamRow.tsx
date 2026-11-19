import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Select, Slider, Switch, ToggleGroup, Tooltip } from 'radix-ui';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { useEngineValue } from '../../engine/hooks';
import { portalContainer } from '../../lib/portal';
import { editableNumber, parseNumber } from '../../lib/number-input';
import { formatNumber, toSpeech } from '../../lib/units';
import type { ChoiceDef, ParamDef, SliderDef, ToggleDef } from '../../params/registry';
import {
    clampSlider,
    isModified,
    paramVisible,
    readParam,
    referenceValue,
    resetParam,
    setParam,
    sliderFloor,
} from '../../params/params';

const LOG_POSITIONS = 1000;

const UNIT_SPEECH: Record<string, string> = {
    r_s: 'Schwarzschild radii',
    '°': 'degrees',
    K: 'kelvin',
    '×': 'times',
};

function decimalsOf(step: number): number {
    const text = String(step);
    return text.includes('.') ? text.split('.')[1].length : 0;
}

export function formatParamValue(def: ParamDef, value: unknown): string {
    if (def.control === 'toggle') return value ? 'On' : 'Off';
    if (def.control !== 'slider') {
        return def.options.find((option) => option.value === value)?.label ?? String(value);
    }
    const numeric = Number(value);
    const text = def.format
        ? def.format(numeric)
        : formatNumber(numeric, { decimals: decimalsOf(def.step) });
    return def.unit ? `${text} ${def.unit}` : text;
}

function toPosition(def: SliderDef, value: number): number {
    if (def.scale !== 'log') return value;
    const low = Math.log(sliderFloor(def));
    const high = Math.log(def.max);
    return Math.round(((Math.log(value) - low) / (high - low)) * LOG_POSITIONS);
}

function fromPosition(def: SliderDef, position: number): number {
    if (def.scale !== 'log') return position;
    const low = Math.log(sliderFloor(def));
    const high = Math.log(def.max);
    return Math.exp(low + (position / LOG_POSITIONS) * (high - low));
}

// Screen readers get spoken units ("Schwarzschild radii" rather than "r_s").
export function speakParamValue(def: ParamDef, value: unknown): string {
    if (def.control !== 'slider' || !def.unit) return toSpeech(formatParamValue(def, value));
    const text = toSpeech(formatParamValue({ ...def, unit: undefined }, value));
    return `${text} ${UNIT_SPEECH[def.unit] ?? def.unit}`;
}

function RowLabel({ def, id, htmlFor }: { def: ParamDef; id: string; htmlFor?: string }) {
    return (
        <Tooltip.Root>
            <Tooltip.Trigger asChild>
                <label id={id} htmlFor={htmlFor} className="param-label">
                    {def.label}
                </label>
            </Tooltip.Trigger>
            <Tooltip.Portal container={portalContainer()}>
                <Tooltip.Content
                    className="tooltip param-tooltip bh-ui"
                    side="left"
                    align="start"
                    sideOffset={14}
                    collisionPadding={12}
                >
                    {def.help}
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

function ResetButton({ def }: { def: ParamDef }) {
    const modified = useEngineValue(() => isModified(def));
    if (!modified) return <span className="reset-slot" aria-hidden="true" />;
    const target = formatParamValue(def, referenceValue(def));
    return (
        <button
            type="button"
            className="icon-btn reset-btn"
            aria-label={`Reset ${def.label} to ${speakParamValue(def, referenceValue(def))}`}
            title={`Reset to ${target}`}
            onClick={() => resetParam(def)}
        >
            <RotateCcw size={13} aria-hidden="true" />
        </button>
    );
}

function ValueChip({ def, value, labelId }: { def: SliderDef; value: number; labelId: string }) {
    const [draft, setDraft] = useState<string | null>(null);
    const chipId = useId();
    const cancelled = useRef(false);
    const commit = () => {
        if (draft !== null && !cancelled.current) {
            const parsed = parseNumber(draft);
            if (Number.isFinite(parsed)) setParam(def, clampSlider(def, parsed));
        }
        cancelled.current = false;
        setDraft(null);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            event.currentTarget.blur();
        }
    };
    if (draft !== null) {
        return (
            <input
                className="value-input num"
                value={draft}
                autoFocus
                inputMode="decimal"
                spellCheck={false}
                aria-labelledby={labelId}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={onKeyDown}
                onFocus={(event) => event.target.select()}
            />
        );
    }
    return (
        <button
            type="button"
            id={chipId}
            className="value-chip num"
            aria-labelledby={`${labelId} ${chipId}`}
            title="Edit value"
            onClick={() => setDraft(editableNumber(value))}
        >
            {formatParamValue(def, value)}
        </button>
    );
}

function SliderRow({ def }: { def: SliderDef }) {
    const value = useEngineValue(() => readParam(def) as number);
    const floor = useEngineValue(() => sliderFloor(def));
    const labelId = useId();
    const helpId = useId();
    const isLog = def.scale === 'log';
    return (
        <div className="param-row param-row--slider">
            <div className="param-head">
                <RowLabel def={def} id={labelId} />
                <ValueChip def={def} value={value} labelId={labelId} />
                <ResetButton def={def} />
            </div>
            <Slider.Root
                className="slider"
                min={isLog ? 0 : floor}
                max={isLog ? LOG_POSITIONS : def.max}
                step={isLog ? 1 : def.step}
                value={[toPosition(def, value)]}
                onValueChange={([position]) => setParam(def, fromPosition(def, position))}
            >
                <Slider.Track className="slider-track">
                    <Slider.Range className="slider-range" />
                </Slider.Track>
                <Slider.Thumb
                    className="slider-thumb"
                    aria-labelledby={labelId}
                    aria-describedby={helpId}
                    aria-valuetext={speakParamValue(def, value)}
                />
            </Slider.Root>
            {def.marks ? (
                <div className="slider-marks" aria-hidden="true">
                    <span>{def.marks[0]}</span>
                    {isLog ? <span>log scale</span> : null}
                    <span>{def.marks[1]}</span>
                </div>
            ) : null}
            <span id={helpId} className="sr-only">
                {def.help}
            </span>
        </div>
    );
}

function ToggleRow({ def }: { def: ToggleDef }) {
    const checked = useEngineValue(() => Boolean(readParam(def)));
    const id = useId();
    const helpId = useId();
    return (
        <div className="param-row param-row--inline">
            <RowLabel def={def} id={`${id}-label`} htmlFor={id} />
            <ResetButton def={def} />
            <Switch.Root
                id={id}
                className="switch"
                checked={checked}
                aria-describedby={helpId}
                onCheckedChange={(next) => setParam(def, next)}
            >
                <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            <span id={helpId} className="sr-only">
                {def.help}
            </span>
        </div>
    );
}

function SelectRow({ def }: { def: ChoiceDef }) {
    const value = useEngineValue(() => String(readParam(def)));
    const id = useId();
    const helpId = useId();
    return (
        <div className="param-row param-row--inline">
            <RowLabel def={def} id={`${id}-label`} htmlFor={id} />
            <ResetButton def={def} />
            <Select.Root value={value} onValueChange={(next) => setParam(def, next)}>
                <Select.Trigger
                    id={id}
                    className="select-trigger"
                    aria-labelledby={`${id}-label ${id}`}
                    aria-describedby={helpId}
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
                        align="end"
                    >
                        <Select.Viewport>
                            {def.options.map((option) => (
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
            <span id={helpId} className="sr-only">
                {def.help}
            </span>
        </div>
    );
}

function SegmentedRow({ def }: { def: ChoiceDef }) {
    const value = useEngineValue(() => String(readParam(def)));
    const labelId = useId();
    const helpId = useId();
    const hint = def.options.find((option) => option.value === value)?.hint;
    return (
        <div className="param-row">
            <div className="param-head">
                <RowLabel def={def} id={labelId} />
                <ResetButton def={def} />
            </div>
            <ToggleGroup.Root
                type="single"
                className="segmented"
                value={value}
                aria-labelledby={labelId}
                aria-describedby={helpId}
                onValueChange={(next) => next && setParam(def, next)}
            >
                {def.options.map((option) => (
                    <ToggleGroup.Item
                        key={option.value}
                        value={option.value}
                        className="segmented-item"
                    >
                        {option.label}
                    </ToggleGroup.Item>
                ))}
            </ToggleGroup.Root>
            {hint ? <p className="param-hint">{hint}</p> : null}
            <span id={helpId} className="sr-only">
                {def.help}
            </span>
        </div>
    );
}

// `anchored` gives the row the id that revealParam() looks for; a second copy of the row, as in the
// command palette, goes without it.
export function ParamRow({ def, anchored = true }: { def: ParamDef; anchored?: boolean }) {
    const visible = useEngineValue(() => paramVisible(def));
    if (!visible) return null;
    let row;
    if (def.control === 'slider') row = <SliderRow def={def} />;
    else if (def.control === 'toggle') row = <ToggleRow def={def} />;
    else if (def.control === 'segmented') row = <SegmentedRow def={def} />;
    else row = <SelectRow def={def} />;
    return <div id={anchored ? `param-${def.id}` : undefined}>{row}</div>;
}
