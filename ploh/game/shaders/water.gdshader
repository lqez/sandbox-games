// 얕은 물웅덩이. 잔물결 노멀을 두 겹 흘려 횃불이 반짝이게 하고,
// 화면 텍스처를 살짝 일그러뜨려 바닥이 비쳐 보이게 하며, 위쪽을 섞어 반사처럼 보이게 한다.
// UV.y는 가장자리 0 → 가운데 1이라 가장자리가 부드럽게 사라진다.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D ripple_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform bool has_nrm = false;
uniform vec4 tint : source_color = vec4(0.32, 0.4, 0.48, 1.0);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz * 0.35;
	vec3 n = vec3(0.0, 0.0, 1.0);
	if (has_nrm) {
		vec3 a = texture(ripple_nrm, uv + vec2(TIME * 0.021, TIME * 0.013)).rgb * 2.0 - 1.0;
		vec3 b = texture(ripple_nrm, uv * 1.7 - vec2(TIME * 0.017, -TIME * 0.011)).rgb * 2.0 - 1.0;
		n = normalize(vec3(a.xy + b.xy, a.z * b.z));
		NORMAL_MAP = n * 0.5 + 0.5;
		NORMAL_MAP_DEPTH = 0.5;
	}
	vec2 off = n.xy * 0.012;
	vec3 under = texture(screen_tex, SCREEN_UV + off).rgb;
	vec3 refl = texture(screen_tex, SCREEN_UV + vec2(0.0, -0.05) + off * 2.0).rgb;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.5);
	// 바닥이 비쳐 보이되 살짝 밝고 푸르게, 비스듬할수록 위쪽(벽·횃불)을 더 비춘다
	vec3 col = mix(under * 0.95, refl * 1.15, 0.35 + fres * 0.45);
	ALBEDO = mix(col, tint.rgb * 1.6, 0.18);
	ROUGHNESS = 0.05;
	METALLIC = 0.0;
	SPECULAR = 0.9;
	ALPHA = smoothstep(0.0, 0.35, UV.y) * 0.8;
}
