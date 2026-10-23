// 던전 벽: 벽 길이와 높이로 계산한 UV에 돌 텍스처, 아래쪽은 습기와 이끼로 어둡게.
//
// 카메라를 가리는 벽은 깎지 않고 디더링으로 녹인다(불투명 패스에서 픽셀을 버려 정렬 문제가 없다).
// - 카메라와 영웅을 잇는 선 가까이에 있는, 영웅보다 앞쪽 벽은 둥글게 뚫린다
// - 카메라를 향한 앞쪽 벽(정점 색 알파 = 앞쪽 정도)은 전체가 반쯤 비쳐 보인다
shader_type spatial;

uniform sampler2D wall_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wall_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D grime_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform bool has_tex = false;
uniform bool has_nrm = false;
uniform bool has_grime = false;
uniform vec4 base_color : source_color = vec4(0.5, 0.48, 0.52, 1.0);
uniform float meters_per_tile = 3.0;
uniform bool is_top = false;
uniform vec3 player_pos = vec3(0.0);
uniform vec3 cam_pos = vec3(0.0, 10.0, 10.0);
uniform float hole_radius = 3.0;
uniform float front_see = 0.0;      // 앞쪽 벽 전체를 비치게 할 정도(저해상도에서 지글거려 기본은 끈다)

varying float height;
varying vec3 wpos;

void vertex() {
	height = VERTEX.y;
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

float bayer4(vec2 p) {
	ivec2 i = ivec2(mod(p, 4.0));
	int idx = i.x + i.y * 4;
	float m[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
	return (m[idx] + 0.5) / 16.0;
}

void fragment() {
	// 녹일 정도: 카메라→영웅 선에서의 거리와, 영웅보다 앞쪽인지로 정한다
	vec3 target = player_pos + vec3(0.0, 1.0, 0.0);
	vec3 ray = target - cam_pos;
	float len = length(ray);
	vec3 dir = ray / len;
	float t = dot(wpos - cam_pos, dir);
	float dist = length((wpos - cam_pos) - dir * t);
	float hole = (1.0 - smoothstep(hole_radius * 0.6, hole_radius, dist)) * step(t, len - 0.4);
	float front = COLOR.a * front_see;
	float fade = max(hole, front);
	if (fade > 0.001 && bayer4(FRAGCOORD.xy) < fade) {
		discard;
	}
	vec2 uv = (is_top ? wpos.xz : UV) / meters_per_tile;
	vec3 c = has_tex ? texture(wall_tex, uv).rgb : base_color.rgb;
	float damp = is_top ? 0.0 : 1.0 - smoothstep(0.0, 1.2, height);
	if (has_grime) {
		vec4 g = texture(grime_tex, uv * 1.3);
		c = mix(c, g.rgb, g.a * damp * 0.9);
	}
	c *= mix(1.0, 0.6, damp);
	if (is_top) {
		c *= 0.55;
	}
	ALBEDO = c * COLOR.rgb;
	if (has_nrm) {
		NORMAL_MAP = texture(wall_nrm, uv).rgb;
		NORMAL_MAP_DEPTH = 1.0;
	}
	ROUGHNESS = mix(0.9, 0.55, damp);
}
