// 던전 바닥: 월드 좌표로 돌 텍스처를 깔고, 회전·축척을 달리한 두 번째 샘플과 진흙을 노이즈로 섞어
// 반복과 격자 느낌을 지운다. 벽 가까이는 정점 색(어둠)으로 눌러 준다.
shader_type spatial;

uniform sampler2D stone_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D stone_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D mud_tex : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D noise_tex : repeat_enable, filter_linear;
uniform bool has_tex = false;
uniform bool has_nrm = false;
uniform vec4 base_color : source_color = vec4(0.46, 0.44, 0.47, 1.0);
uniform float meters_per_tile = 3.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz / meters_per_tile;
	vec2 uv2 = mat2(vec2(0.8, -0.6), vec2(0.6, 0.8)) * uv * 0.73 + vec2(0.37, 0.11);
	float n = texture(noise_tex, wpos.xz * 0.035).r;
	vec3 s1 = has_tex ? texture(stone_tex, uv).rgb : base_color.rgb;
	vec3 s2 = has_tex ? texture(stone_tex, uv2).rgb : base_color.rgb * 0.95;
	vec3 stone = mix(s1, s2, smoothstep(0.38, 0.62, n));
	float mudm = smoothstep(0.58, 0.82, texture(noise_tex, wpos.xz * 0.08 + vec2(0.5)).r);
	vec3 mud = has_tex ? texture(mud_tex, uv * 1.4).rgb : base_color.rgb * 0.7;
	ALBEDO = mix(stone, mud, mudm) * COLOR.rgb;
	if (has_nrm) {
		NORMAL_MAP = mix(texture(stone_nrm, uv).rgb, texture(stone_nrm, uv2).rgb, smoothstep(0.38, 0.62, n));
		NORMAL_MAP_DEPTH = 0.8;
	}
	ROUGHNESS = mix(0.82, 0.5, mudm);
	SPECULAR = 0.35;
}
