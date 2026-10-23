// 던전 벽: 아래(바닥에서 약 2.2m까지)는 다듬은 성벽 돌, 그 위는 성을 삼킨 동굴 암반.
// 경계는 노이즈로 흔들고, 경계 바로 아래를 조금 어둡게 해서 무너진 단면처럼 보이게 한다.
// 벽 위와 벽 너머(is_top)는 허공 대신 흙과 뿌리, 벽 가장자리는 암반이다.
//
// 정점 데이터: UV2.x = 구워 둔 횃불 빛, UV2.y = 그 자리 바닥 높이(벽 높이를 바닥 기준으로 재려고),
// COLOR.a = 카메라를 향한 앞쪽 벽 정도, is_top일 때 COLOR.g = 벽 가장자리(암반) 정도, COLOR.r = 밝기
//
// 카메라를 가리는 벽은 깎지 않고 디더링으로 녹인다(불투명 패스에서 픽셀을 버려 정렬 문제가 없다).
// - 카메라와 영웅을 잇는 선 가까이에 있는, 영웅보다 앞쪽 벽은 둥글게 뚫린다
// - 카메라를 향한 앞쪽 벽(정점 색 알파 = 앞쪽 정도)은 전체가 반쯤 비쳐 보인다
shader_type spatial;

uniform sampler2D wall_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D wall_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D rock_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D rock_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D earth_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D grime_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D noise_tex : repeat_enable, filter_linear;
uniform bool has_tex = false;
uniform bool has_nrm = false;
uniform bool has_rock = false;
uniform bool has_grime = false;
uniform vec4 base_color : source_color = vec4(0.5, 0.48, 0.52, 1.0);
uniform float meters_per_tile = 3.0;
uniform float tier_height = 2.2;     // 성벽 돌이 끝나고 암반이 시작하는 높이(바닥 기준)
uniform bool is_top = false;
uniform vec3 player_pos = vec3(0.0);
uniform vec3 cam_pos = vec3(0.0, 10.0, 10.0);
uniform float hole_radius = 3.0;
uniform float front_see = 0.0;      // 앞쪽 벽 전체를 비치게 할 정도(저해상도에서 지글거려 기본은 끈다)
uniform vec4 bake_color : source_color = vec4(1.0, 0.62, 0.32, 1.0);
uniform float bake_gain = 0.8;

varying vec3 wpos;

void vertex() {
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
	// 벽 너머 흙 면은 영웅을 실제로 가리는 높은 부분만 좁게 녹인다(넓게 녹이면 그 뒤 빈 배경이 구멍으로 보인다)
	float r = is_top ? hole_radius * 0.6 : hole_radius;
	float hole = (1.0 - smoothstep(r * 0.6, r, dist)) * step(t, len - 0.4);
	// 영웅보다 카메라 쪽에 있는 것만 녹인다(내려다보는 각도라 영웅 뒤 벽의 윗부분도 시선 앞쪽으로 잡힌다)
	vec3 to_cam = vec3(cam_pos.x - target.x, 0.0, cam_pos.z - target.z);
	hole *= step(0.3, dot(wpos - target, normalize(to_cam)));
	if (is_top) {
		hole *= step(player_pos.y + 0.6, wpos.y);
	}
	float front = COLOR.a * front_see;
	float fade = max(hole, front);
	if (fade > 0.001 && bayer4(FRAGCOORD.xy) < fade) {
		discard;
	}
	vec3 c;
	vec3 nrm = vec3(0.5, 0.5, 1.0);
	float rough = 0.9;
	if (is_top) {
		// 벽 위와 벽 너머: 흙과 뿌리, 벽 가장자리는 암반
		vec2 uv = wpos.xz / 3.0;
		vec3 earth = has_rock ? texture(earth_tex, uv).rgb : base_color.rgb * 0.6;
		vec3 rock = has_rock ? texture(rock_tex, wpos.xz / 4.0).rgb : base_color.rgb;
		float n = texture(noise_tex, wpos.xz * 0.05).r;
		float edge = smoothstep(0.2, 0.8, COLOR.g + (n - 0.5) * 0.5);
		c = mix(earth, rock * 0.85, edge) * COLOR.r;
		if (has_rock) {
			nrm = mix(vec3(0.5, 0.5, 1.0), texture(rock_nrm, wpos.xz / 4.0).rgb, edge);
		}
	} else {
		float hf = wpos.y - UV2.y;
		float n = texture(noise_tex, vec2(UV.x * 0.08, 0.37)).r;
		float tier = has_rock ? smoothstep(tier_height - 0.15, tier_height + 0.15, hf + (n - 0.5) * 0.9) : 0.0;
		vec2 uv = UV / meters_per_tile;
		vec3 stone = has_tex ? texture(wall_tex, uv).rgb : base_color.rgb;
		vec3 rock = has_rock ? texture(rock_tex, UV / 4.0).rgb : stone;
		// 아래쪽은 습기와 이끼로 어둡게
		float damp = 1.0 - smoothstep(0.0, 1.2, hf);
		if (has_grime) {
			vec4 g = texture(grime_tex, uv * 1.3);
			stone = mix(stone, g.rgb, g.a * damp * 0.9);
		}
		stone *= mix(1.0, 0.6, damp);
		// 성벽이 끝나는 단면은 조금 어둡다
		stone *= 1.0 - 0.28 * smoothstep(tier_height - 0.6, tier_height - 0.1, hf + (n - 0.5) * 0.9);
		c = mix(stone, rock * 0.9, tier);
		if (has_nrm) {
			nrm = texture(wall_nrm, uv).rgb;
		}
		if (has_rock) {
			nrm = mix(nrm, texture(rock_nrm, UV / 4.0).rgb, tier);
		}
		rough = mix(0.9, 0.55, damp);
	}
	ALBEDO = c;
	NORMAL_MAP = nrm;
	NORMAL_MAP_DEPTH = 1.0;
	ROUGHNESS = rough;
	float fl = 0.93 + 0.04 * sin(TIME * 9.0 + wpos.x * 0.7) + 0.03 * sin(TIME * 23.0 + wpos.z * 0.9);
	EMISSION = c * bake_color.rgb * UV2.x * bake_gain * fl;
}
