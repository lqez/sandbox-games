// 뒤집은 껍데기 방식의 외곽선. 모델 크기·거리와 상관없이 화면에서 같은 두께가 되도록
// 클립 공간에서 화면 쪽 법선 방향으로 밀어낸다(width는 화면 높이 대비 비율).
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_opaque;

uniform vec4 line_color : source_color = vec4(0.08, 0.06, 0.12, 1.0);
uniform float width = 0.0022;
uniform float depth_push = 0.15;    // 껍데기를 카메라에서 이만큼(m) 뒤로 민다: 몇 cm 앞에 드리운 앞머리 안쪽 면 같은 것이 얼굴을 덮지 않고 윤곽에만 남는다

void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	view.xyz += normalize(view.xyz) * depth_push;
	vec4 clip = PROJECTION_MATRIX * view;
	vec3 n = normalize(mat3(MODELVIEW_MATRIX) * NORMAL);
	vec2 dir = (PROJECTION_MATRIX * vec4(n, 0.0)).xy;
	// 윤곽(시선과 거의 나란한 면) 근처만 밀어낸다. 카메라를 정면으로 등진 안쪽 면(얼굴 앞 앞머리의 안쪽 등)까지 밀면
	// 그 검은 껍데기가 얼굴 위를 덮어 얼굴이 검게 나온다
	float facing = dot(n, normalize(-view.xyz));
	float k = 1.0 - smoothstep(0.15, 0.6, -facing);
	if (length(dir) > 0.0001) {
		dir = normalize(dir);
		dir.x *= VIEWPORT_SIZE.y / VIEWPORT_SIZE.x;
		clip.xy += dir * width * 2.0 * clip.w * k;
	}
	POSITION = clip;
}

void fragment() {
	ALBEDO = line_color.rgb;
}
