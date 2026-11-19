// Keeps the address bar in step with the view through the share codec (src/features/share): a link
// restores the scenario, the parameters, the camera and the observer mode on load and on
// back/forward navigation, and the current view is written back once changes settle.

import { toast } from 'sonner';
import * as share from '../../features/share/index.js';
import {
    applyBlackHolePreset,
    baseBlackHolePreset,
    cameraControls,
    canvas,
    commitParamChange,
    currentMode,
    dive,
    engineCamera,
    enterMode,
    getPathValue,
    hover,
    markScenarioCustom,
    params,
    presentationBusy,
    seekDiveRadius,
    seekHoverRadius,
    setCameraPose,
    setObserverMotion,
    setPathValue,
    subscribeEngine,
} from '../engine/engine';
import { subscribeFrames } from '../engine/telemetry';
import { scenarioById, scenarioByName } from '../lib/scenarios';
import { PARAMS } from '../params/registry';
import { isModified } from '../params/params';

type ViewState = Record<string, unknown>;

interface ViewStateSync {
    start(): void;
    schedule(): void;
    pause(): void;
    resume(): void;
    shareUrl(state?: ViewState): string;
}

const codec = share.viewStateCodec as unknown;
const createViewStateSync = share.createViewStateSync as unknown as (options: {
    codec: unknown;
    read: () => ViewState;
    apply: (state: ViewState, info: { source: string; issues: unknown[] }) => void;
}) => ViewStateSync;
const collectViewState = share.collectViewState as (
    getPathValue: (path: string) => unknown,
    custom: ViewState,
) => ViewState;
const applyBoundViewState = share.applyBoundViewState as (
    state: ViewState,
    setPathValue: (path: string, value: unknown) => unknown,
) => ViewState;
const cameraAnglesFromQuaternion = share.cameraAnglesFromQuaternion as (q: {
    x: number;
    y: number;
    z: number;
    w: number;
}) => number[];
const cameraPoseFromAngles = share.cameraPoseFromAngles as (angles: number[]) => {
    position: number[];
    up: number[];
};

let sync: ViewStateSync | null = null;

function readViewState(): ViewState {
    const mode = currentMode();
    const scenario = mode === 'dive' ? dive : mode === 'hover' ? hover : null;
    const custom: ViewState = {
        'camera.angles': cameraAnglesFromQuaternion(engineCamera().quaternion),
        'scenario.mode': scenario ? mode : params().observer.motion ? 'orbit' : 'static',
        'scenario.radius': scenario ? scenario.currentR : null,
        'scenario.paused': scenario ? scenario.paused : false,
        'scenario.preset': scenarioByName(baseBlackHolePreset())?.id ?? 'default',
    };
    if (scenario) custom['observer.distance'] = scenario.prevDistance;
    return collectViewState(getPathValue, custom);
}

function applyViewState(state: ViewState, info: { source: string; issues: unknown[] }): void {
    enterMode('orbit');
    const scenario = scenarioById(String(state['scenario.preset']));
    if (scenario) applyBlackHolePreset(scenario.name);
    const custom = applyBoundViewState(state, setPathValue);
    const mode = custom['scenario.mode'];
    setObserverMotion(mode === 'orbit');
    const pose = cameraPoseFromAngles(custom['camera.angles'] as number[]);
    setCameraPose(pose.position, pose.up);
    if (mode === 'dive' || mode === 'hover') {
        enterMode(mode);
        const radius = custom['scenario.radius'];
        if (typeof radius === 'number') {
            if (mode === 'dive') seekDiveRadius(radius);
            else seekHoverRadius(radius);
        }
        const target = mode === 'dive' ? dive : hover;
        target.paused = Boolean(custom['scenario.paused']);
    }
    if (scenario && PARAMS.some((def) => def.track === 'scenario' && isModified(def))) {
        markScenarioCustom();
    }
    commitParamChange('compile');
    if (info.issues.length) {
        toast('Some values in the link were out of range and have been adjusted.', {
            id: 'share-issues',
        });
    }
}

export function startViewStateSync(): void {
    if (sync) return;
    sync = createViewStateSync({ codec, read: readViewState, apply: applyViewState });
    sync.start();
    const schedule = () => sync?.schedule();
    subscribeEngine(schedule);
    cameraControls()?.addEventListener('change', schedule);
    canvas()?.addEventListener('pointerup', schedule);
    let busy = false;
    subscribeFrames(() => {
        const next = presentationBusy();
        if (next === busy) return;
        busy = next;
        if (busy) sync?.pause();
        else sync?.resume();
    });
}

export async function copyViewLink(): Promise<void> {
    if (!sync) return;
    const url = sync.shareUrl();
    try {
        await navigator.clipboard.writeText(url);
        toast.success('View link copied', { id: 'share-link' });
    } catch {
        toast.error('Could not copy the link. It is in the address bar.', { id: 'share-link' });
        window.history.replaceState(window.history.state, '', url);
    }
}
