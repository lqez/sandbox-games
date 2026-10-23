// 뒤집은 껍데기 방식의 외곽선. 카메라에서 멀어도 굵기가 비슷하게 보이도록 거리로 보정한다.
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_opaque;

uniform vec4 line_color : source_color = vec4(0.08, 0.06, 0.12, 1.0);
uniform float width = 0.012;

void vertex() {
	vec4 view_pos = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	float dist = max(-view_pos.z, 1.0);
	VERTEX += NORMAL * width * dist * 0.35;
}

void fragment() {
	ALBEDO = line_color.rgb;
}
