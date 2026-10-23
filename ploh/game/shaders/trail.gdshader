// 칼날 궤적 리본. UV.x는 새로움(1이 방금), UV.y는 날의 안쪽(0)→칼끝(1).
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.9, 0.7, 1.0);

void fragment() {
	float fresh = clamp(UV.x, 0.0, 1.0);
	float edge = smoothstep(0.0, 0.6, UV.y) * (1.0 - smoothstep(0.92, 1.0, UV.y));
	float core = pow(fresh, 3.0) * smoothstep(0.55, 1.0, UV.y);
	vec3 col = mix(color.rgb, vec3(1.0), core * 0.6);
	ALBEDO = col * (fresh * fresh) * edge * (0.45 + core * 0.8);
	ALPHA = clamp(fresh * edge * 0.6, 0.0, 1.0);
}
