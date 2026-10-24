// 궁병 조준선(research/look/ART_TARGET.md 5.2): 바닥에 깔린 점선. 대시 0.4m, 간격 0.25m.
// solid가 1이면 실선(쏘기 직전 200ms). UV.y는 궁병(0) → 영웅(1), len은 선의 실제 길이(m).
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.353, 0.212, 0.8);
uniform float len = 6.0;
uniform float solid = 0.0;

void fragment() {
	float d = UV.y * len;
	float dash = step(fract(d / 0.65), 0.4 / 0.65);
	float a = mix(dash, 1.0, solid) * color.a;
	// 양 옆 가장자리는 부드럽게
	a *= smoothstep(0.0, 0.3, 1.0 - abs(UV.x * 2.0 - 1.0));
	ALBEDO = color.rgb * a * 1.6;
	ALPHA = clamp(a, 0.0, 1.0);
}
