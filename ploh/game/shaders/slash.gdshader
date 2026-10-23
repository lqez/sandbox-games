// 베기 궤적. 부채꼴 메시의 UV(u: 각도 방향, v: 반지름 방향)로 칼이 쓸고 지나가는 띠를 그린다.
// progress가 0→1로 가며 앞머리가 지나가고, 뒤로 꼬리가 사라진다.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.9, 0.7, 1.0);
uniform float progress = 0.0;
uniform float fade = 1.0;
uniform float tail = 0.55;

void fragment() {
	float head = progress * (1.0 + tail);
	float u = UV.x;
	float a = smoothstep(head - tail, head, u) * (1.0 - smoothstep(head, head + 0.02, u));
	float edge = smoothstep(0.0, 0.35, UV.y) * (1.0 - smoothstep(0.75, 1.0, UV.y));
	float core = pow(edge, 3.0);
	vec3 col = mix(color.rgb, vec3(1.0), core * 0.45);
	ALBEDO = col * a * fade * (0.9 + core * 1.3);
	ALPHA = clamp(a * (0.4 + edge) * fade, 0.0, 1.0);
}
