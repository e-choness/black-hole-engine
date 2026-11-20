// General-purpose helpers: coordinate projections, relativistic velocity transforms and the
// value noise behind the turbulence of every flow model.

import {
    Fn,
    If,
    Loop,
    asin,
    atan,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    mix,
    sin,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';

export const M_PI = Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export const sq = (x) => x.mul(x);

export const sphere_map = Fn(
    ([p]) => vec2(atan(p.x, p.y).div(M_PI).mul(0.5).add(0.5), asin(p.z).div(M_PI).add(0.5)),
    { p: 'vec3', return: 'vec2' },
);

export const smooth_step = Fn(
    ([x, threshold]) => float(1.0).div(exp(x.sub(threshold).negate()).add(1.0)),
    { x: 'float', threshold: 'float', return: 'float' },
);

export const lorentz_velocity_transformation = Fn(
    ([moving_v, frame_v]) => {
        const v = length(frame_v);
        If(v.greaterThan(0.0), () => {
            const v_axis = frame_v.negate().div(v);
            const gamma = float(1.0).div(sqrt(float(1.0).sub(v.mul(v))));
            const moving_par = dot(moving_v, v_axis);
            const moving_perp = moving_v.sub(v_axis.mul(moving_par));
            const denom = v.mul(moving_par).add(1.0);
            return v_axis.mul(moving_par.add(v)).add(moving_perp.div(gamma)).div(denom);
        });
        return moving_v;
    },
    { moving_v: 'vec3', frame_v: 'vec3', return: 'vec3' },
);

export const contract = Fn(
    ([x, d, mult]) => {
        const par = dot(x, d);
        return x.sub(d.mul(par)).add(d.mul(par).mul(mult));
    },
    { x: 'vec3', d: 'vec3', mult: 'float', return: 'vec3' },
);

export const safe_normalize = Fn(
    ([v]) => {
        const l = length(v);
        If(l.greaterThan(1e-6), () => {
            return v.div(l);
        });
        return vec3(0.0);
    },
    { v: 'vec3', return: 'vec3' },
);

export const rotate_about_z = Fn(
    ([p, angle]) => {
        const c = cos(angle);
        const s = sin(angle);
        return vec3(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y)), p.z);
    },
    { p: 'vec3', angle: 'float', return: 'vec3' },
);

export const hash12 = Fn(
    ([p]) => {
        const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
        p3.addAssign(dot(p3, p3.yzx.add(33.33)));
        return fract(p3.x.add(p3.y).mul(p3.z));
    },
    { p: 'vec2', return: 'float' },
);

export const value_noise = Fn(
    ([p]) => {
        const i = floor(p);
        const f = fract(p);
        const a = hash12(i);
        const b = hash12(i.add(vec2(1.0, 0.0)));
        const c = hash12(i.add(vec2(0.0, 1.0)));
        const d = hash12(i.add(vec2(1.0, 1.0)));
        const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    },
    { p: 'vec2', return: 'float' },
);

export const fbm = Fn(
    ([p_in]) => {
        const p = vec2(p_in).toVar();
        const sum = float(0.0).toVar();
        const amp = float(0.5).toVar();
        Loop(4, () => {
            sum.addAssign(amp.mul(value_noise(p)));
            p.assign(p.mul(2.03).add(vec2(17.13, -11.7)));
            amp.mulAssign(0.5);
        });
        return sum;
    },
    { p_in: 'vec2', return: 'float' },
);
