// 검기 리본. UV.x는 새로움(1이 방금), UV.y는 날의 안쪽(0)→칼끝(1).
// 칼끝 쪽 가장자리가 하얗게 달아오르고, 안쪽과 꼬리로 갈수록 영웅 색으로 옅어진다.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.9, 0.7, 1.0);

void fragment() {
	float fresh = clamp(UV.x, 0.0, 1.0);
	float body = smoothstep(0.0, 0.45, UV.y) * (1.0 - smoothstep(0.97, 1.0, UV.y));
	// 칼끝 가장자리의 빛선(새로울수록 굵다)
	float edge = smoothstep(0.78 - fresh * 0.12, 0.96, UV.y) * (1.0 - smoothstep(0.98, 1.0, UV.y));
	float f2 = fresh * fresh;
	vec3 col = color.rgb * body * (0.35 + 0.65 * f2) * 1.4 + vec3(1.0, 0.97, 0.9) * edge * (0.4 + 1.6 * f2);
	ALBEDO = col * fresh;
	ALPHA = clamp((body * 0.7 + edge) * fresh, 0.0, 1.0);
}
