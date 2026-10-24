// 검기 초승달(research/look/ART_TARGET.md 2.2). 칼끝이 지나간 궤적을 따라 그린 띠.
// UV.x: 휘두른 순서(0 꼬리 → 1 머리), UV.y: 안쪽(0) → 바깥(1). 두께는 메시가 양 끝으로 가늘어진다.
// 가운데 약 30%는 하얀 심, 바깥은 영웅 색. 밝은 바닥 위에서 더하기로 그리면 무슨 색이든 하얗게 날아가므로
// 셀 셰이딩처럼 덮어 그린다(blend_mix): 가장자리가 또렷한 채색 띠 + 하얀 심 + 바깥 테두리 한 줄.
// erase가 0→1로 가며 꼬리부터 지우되, 노이즈로 가장자리가 바스러지고 지워지는 앞머리가 잠깐 더 밝게 탄다(디졸브).
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.75, 0.3, 1.0);
uniform float erase = 0.0;
uniform float energy = 1.0;
uniform float seed = 0.0;
uniform float core_w = 0.66;    // 하얀 심이 시작하는 두께 비율(작을수록 심이 넓다). 콤보 단계가 낮춘다
uniform float grad = 0.0;       // 1이면 꼬리의 영웅 색이 머리 쪽에서 백금으로 바뀐다(20콤보+)
uniform float alpha_mul = 1.0;  // 잔상 호는 옅게

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
	float across = 1.0 - abs(UV.y * 2.0 - 1.0);
	float core = smoothstep(core_w, core_w + 0.14, across);
	float body = smoothstep(0.04, 0.16, across);
	float rim = body * (1.0 - smoothstep(0.16, 0.3, across));
	// 지우는 앞머리를 노이즈로 흔들어 가장자리가 찢어지며 사라진다
	float n = noise(vec2(UV.x * 9.0, UV.y * 2.5) + seed);
	float front = UV.x + (n - 0.5) * 0.3;
	float keep = smoothstep(erase - 0.04, erase + 0.08, front);
	float ember = (1.0 - smoothstep(0.0, 0.14, abs(front - erase))) * step(0.02, erase) * (1.0 - erase);
	// 꼬리 쪽은 조금 옅다
	float head = mix(0.7, 1.0, UV.x);
	// 몸통 색: 영웅 색. 높은 콤보에서는 머리 쪽이 백금(#FFEAB8)으로 번진다(몸통 전체가 하얘지지는 않는다)
	vec3 base = mix(color.rgb, vec3(1.0, 0.92, 0.72), grad * smoothstep(0.3, 1.0, UV.x) * 0.85);
	vec3 c = mix(base * energy, vec3(1.0, 0.99, 0.95), core);
	c = mix(c, color.rgb * 0.7, rim * 0.6);
	c = mix(c, vec3(1.0, 0.97, 0.9), ember * 0.7);
	float a = body * head * (keep * (0.92 - erase * 0.3) + ember * 0.5) * alpha_mul;
	ALBEDO = c;
	ALPHA = clamp(a, 0.0, 1.0);
}
