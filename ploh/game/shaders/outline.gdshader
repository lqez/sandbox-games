// 뒤집은 껍데기 방식의 외곽선. 모델 크기·거리와 상관없이 화면에서 같은 두께가 되도록
// 클립 공간에서 화면 쪽 법선 방향으로 밀어낸다(width는 화면 높이 대비 비율).
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_opaque;

uniform vec4 line_color : source_color = vec4(0.08, 0.06, 0.12, 1.0);
uniform float width = 0.0022;

void vertex() {
	vec4 clip = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	vec3 n = mat3(MODELVIEW_MATRIX) * NORMAL;
	vec2 dir = (PROJECTION_MATRIX * vec4(n, 0.0)).xy;
	if (length(dir) > 0.0001) {
		dir = normalize(dir);
		dir.x *= VIEWPORT_SIZE.y / VIEWPORT_SIZE.x;
		clip.xy += dir * width * 2.0 * clip.w;
	}
	POSITION = clip;
}

void fragment() {
	ALBEDO = line_color.rgb;
}
