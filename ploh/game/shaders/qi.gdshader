// 검기 초승달(research/look/ART_TARGET.md 2.2). 칼끝이 지나간 궤적을 따라 그린 띠.
// UV.x: 휘두른 순서(0 꼬리 → 1 머리), UV.y: 안쪽(0) → 바깥(1). 두께는 메시가 양 끝으로 가늘어진다.
// 가운데 30%는 하얀 심, 바깥은 영웅 색. erase가 0→1로 가며 꼬리부터 지운다.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.85, 0.5, 1.0);
uniform float erase = 0.0;
uniform float energy = 2.3;

void fragment() {
	float across = 1.0 - abs(UV.y * 2.0 - 1.0);
	float core = smoothstep(0.55, 0.85, across);
	float body = smoothstep(0.0, 0.5, across);
	float keep = smoothstep(erase, erase + 0.12, UV.x);
	// 머리 쪽이 더 밝다
	float head = mix(0.55, 1.0, UV.x);
	vec3 c = mix(color.rgb * energy, vec3(1.0) * energy * 1.1, core);
	float a = body * keep * head;
	ALBEDO = c * a;
	ALPHA = clamp(a, 0.0, 1.0);
}
