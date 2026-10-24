// 칼 궤적 리본. UV.x는 새로움(1이 방금), UV.y는 날의 안쪽(0)→칼끝(1).
// 칼끝 쪽 가장자리가 하얗게 달아오르고, 안쪽과 꼬리로 갈수록 영웅 색으로 옅어진다.
// 밝은 바닥 위에서 더하기로 그리면 하얗게 날아가므로 덮어 그린다(blend_mix): 채색 띠 + 하얀 칼끝 선
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.75, 0.3, 1.0);

void fragment() {
	float fresh = clamp(UV.x, 0.0, 1.0);
	float body = smoothstep(0.0, 0.4, UV.y) * (1.0 - smoothstep(0.97, 1.0, UV.y));
	// 칼끝 가장자리의 빛선(새로울수록 굵다)
	float edge = smoothstep(0.8 - fresh * 0.12, 0.95, UV.y) * (1.0 - smoothstep(0.98, 1.0, UV.y));
	float f2 = fresh * fresh;
	vec3 col = mix(color.rgb, vec3(1.0, 0.98, 0.93), edge * (0.5 + 0.5 * f2));
	ALBEDO = col;
	ALPHA = clamp((body * (0.35 + 0.4 * f2) + edge * 0.6) * fresh, 0.0, 1.0);
}
