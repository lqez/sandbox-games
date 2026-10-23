// 던전 바닥: 월드 좌표로 큰 판석(4m/장)을 깔고, 회전·축척을 달리한 두 번째 샘플을 노이즈로 섞어 반복을 지운다.
// 무작위 얼룩 대신 공간 정보로 칠한다(정점 색):
// - COLOR.r: 벽 가까이 어두운 정도(앰비언트 오클루전 흉내)
// - COLOR.g: 흙·잔해(벽 가까이, 복도에 많다)
// - COLOR.b: 닳은 길(자동 이동 경로를 따라 판석이 조금 밝고 매끈하다)
// 횃불·모닥불 빛은 생성할 때 정점에 구워 둔다(UV2.x). 실제 조명은 영웅 근처 몇 개만 켠다.
shader_type spatial;

uniform sampler2D stone_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D mud_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D noise_tex : repeat_enable, filter_linear;
uniform bool has_tex = false;
uniform bool has_nrm = false;
uniform vec4 base_color : source_color = vec4(0.46, 0.44, 0.47, 1.0);
uniform float meters_per_tile = 4.0;
uniform vec4 bake_color : source_color = vec4(1.0, 0.62, 0.32, 1.0);
uniform float bake_gain = 0.85;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz / meters_per_tile;
	vec2 uv2 = mat2(vec2(0.8, -0.6), vec2(0.6, 0.8)) * uv * 0.73 + vec2(0.37, 0.11);
	float n = texture(noise_tex, wpos.xz * 0.035).r;
	float k = smoothstep(0.38, 0.62, n);
	vec3 s1 = has_tex ? texture(stone_tex, uv).rgb : base_color.rgb;
	vec3 s2 = has_tex ? texture(stone_tex, uv2).rgb : base_color.rgb * 0.95;
	vec3 stone = mix(s1, s2, k);
	float worn = COLOR.b;
	stone *= 1.0 + 0.06 * worn;
	// 흙은 벽 가까이에서 노이즈로 가장자리를 흔들며 번진다
	float mudm = smoothstep(0.25, 0.75, COLOR.g * (0.7 + 0.6 * n));
	vec3 mud = has_tex ? texture(mud_tex, uv * 1.4).rgb : base_color.rgb * 0.7;
	vec3 alb = mix(stone, mud, mudm) * COLOR.r;
	ALBEDO = alb;
	if (has_nrm) {
		NORMAL_MAP = mix(texture(stone_nrm, uv).rgb, texture(stone_nrm, uv2).rgb, k);
		NORMAL_MAP_DEPTH = mix(0.8, 0.35, mudm);
	}
	ROUGHNESS = mix(mix(0.82, 0.66, worn), 0.6, mudm);
	SPECULAR = 0.35;
	float fl = 0.93 + 0.04 * sin(TIME * 9.0 + wpos.x * 0.7) + 0.03 * sin(TIME * 23.0 + wpos.z * 0.9);
	EMISSION = alb * bake_color.rgb * UV2.x * bake_gain * fl;
}
