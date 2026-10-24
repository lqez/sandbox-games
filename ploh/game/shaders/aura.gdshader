// 궁극기 오라.
// mode 0: 몸을 감싼 원기둥 껍질. 위로 흐르는 노이즈를 두 단계로 끊어 셀 느낌의 불길 혀로 만든다.
//         윤곽(화면에서 껍질의 가장자리)에서 밝고 가운데는 옅어 몸이 보인다. 영웅 색을 지키고 하얗게 날리지 않는다
// mode 1: 바닥 빛 고리. 천천히 도는 눈금과 안쪽으로 아주 옅게 번지는 빛
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
	vec3 c = color.rgb;
	if (mode == 0) {
		float h = 1.0 - UV.y;
		vec2 q = vec2(UV.x * 6.0, h * 2.0 - TIME * 1.8);
		float n = noise(q) * 0.6 + noise(q * 2.1 + 7.3) * 0.4;
		// 위로 갈수록 문턱이 높아져 끝이 혀처럼 갈라진다. 두 단계로 끊어 셀 셰이딩처럼
		float t = n - h * 0.95 + 0.4;
		float tongue = smoothstep(0.48, 0.52, t);
		float hot = smoothstep(0.66, 0.7, t);
		float edge = pow(1.0 - abs(dot(NORMAL, VIEW)), 1.4);
		float fade = smoothstep(0.0, 0.1, h);
		a = (tongue * 0.32 + hot * 0.3) * fade * (0.22 + edge * 1.1);
		c = mix(color.rgb, mix(color.rgb, vec3(1.0), 0.4), hot);
	} else if (mode == 2) {
		float h = 1.0 - UV.y;
		float edge = pow(1.0 - abs(dot(NORMAL, VIEW)), 1.2);
		float streak = smoothstep(0.6, 1.0, noise(vec2(UV.x * 18.0, h * 1.5 - TIME * 2.5)));
		a = (edge * 0.45 + streak * 0.3) * pow(1.0 - h, 0.7) * smoothstep(0.0, 0.05, h);
	} else {
		vec2 p = UV * 2.0 - 1.0;
		float r = length(p);
		float ang = atan(p.y, p.x) + TIME * 0.8;
		float ring = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.82));
		float ticks = step(0.5, fract(ang * 24.0 / 6.2832)) * (1.0 - smoothstep(0.0, 0.03, abs(r - 0.7)));
		float inner = (1.0 - smoothstep(0.0, 0.8, r)) * 0.12;
		a = (ring + ticks * 0.6 + inner) * (1.0 - smoothstep(0.88, 0.95, r));
		c = mix(color.rgb, vec3(1.0), clamp((a - 0.8) * 2.0, 0.0, 1.0) * 0.5);
	}
	// 바닥 고리는 밝은 바닥 위라 세기를 낮춰 하얗게 날아가지 않게 한다
	float gain = mode == 1 ? 1.0 : (mode == 2 ? 1.4 : 1.7);
	ALBEDO = c * a * strength * gain;
	ALPHA = clamp(a * strength, 0.0, 1.0);
}
