// 궁극기 오라.
// mode 0: 몸을 감싼 원기둥 껍질. 위로 흘러가는 노이즈 불길이 윤곽(화면에서 껍질의 가장자리)에서 밝고 가운데는 옅어 몸이 보인다
// mode 1: 바닥 빛 고리. 천천히 도는 눈금과 안쪽으로 번지는 빛
// mode 2: 하늘로 솟는 빛기둥. 윤곽이 밝고 위로 갈수록 옅으며, 가는 빛줄기가 위로 흐른다
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back;

uniform vec4 color : source_color = vec4(1.0, 0.8, 0.4, 1.0);
uniform float strength = 1.0;
uniform int mode = 0;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	float a;
	if (mode == 0) {
		float h = 1.0 - UV.y;
		vec2 q = vec2(UV.x * 7.0, h * 2.2 - TIME * 1.6);
		float n = noise(q) * 0.65 + noise(q * 2.3 + 4.1) * 0.35;
		float flame = smoothstep(0.35, 0.85, n + (1.0 - h) * 0.45 - 0.15);
		float fade = (1.0 - smoothstep(0.55, 1.0, h)) * smoothstep(0.0, 0.08, h);
		float edge = pow(1.0 - abs(dot(NORMAL, VIEW)), 1.6);
		a = flame * fade * (0.18 + edge * 1.1);
	} else if (mode == 2) {
		float h = 1.0 - UV.y;
		float edge = pow(1.0 - abs(dot(NORMAL, VIEW)), 1.2);
		float streak = smoothstep(0.6, 1.0, noise(vec2(UV.x * 18.0, h * 1.5 - TIME * 2.5)));
		a = (edge * 0.5 + streak * 0.35) * pow(1.0 - h, 0.7) * smoothstep(0.0, 0.05, h);
	} else {
		vec2 p = UV * 2.0 - 1.0;
		float r = length(p);
		float ang = atan(p.y, p.x) + TIME * 0.8;
		float ring = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.82));
		float ticks = step(0.5, fract(ang * 24.0 / 6.2832)) * (1.0 - smoothstep(0.0, 0.03, abs(r - 0.7)));
		float inner = (1.0 - smoothstep(0.0, 0.8, r)) * 0.25;
		a = (ring + ticks * 0.6 + inner) * (1.0 - smoothstep(0.88, 0.95, r));
	}
	vec3 c = mix(color.rgb, vec3(1.0), clamp(a - 0.6, 0.0, 1.0));
	ALBEDO = c * a * strength * 2.0;
	ALPHA = clamp(a * strength, 0.0, 1.0);
}
