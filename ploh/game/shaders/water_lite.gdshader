// 저사양 물웅덩이: 화면 복사 없이 어두운 물빛과 잔물결 반짝임만 그린다.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;

uniform sampler2D ripple_nrm : hint_normal, repeat_enable, filter_linear_mipmap;
uniform bool has_nrm = false;
uniform vec4 tint : source_color = vec4(0.32, 0.4, 0.48, 1.0);

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	if (has_nrm) {
		vec2 uv = wpos.xz * 0.35;
		vec3 a = texture(ripple_nrm, uv + vec2(TIME * 0.021, TIME * 0.013)).rgb * 2.0 - 1.0;
		vec3 b = texture(ripple_nrm, uv * 1.7 - vec2(TIME * 0.017, -TIME * 0.011)).rgb * 2.0 - 1.0;
		NORMAL_MAP = normalize(vec3(a.xy + b.xy, a.z * b.z)) * 0.5 + 0.5;
		NORMAL_MAP_DEPTH = 0.5;
	}
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.5);
	ALBEDO = tint.rgb * (0.55 + fres * 0.6);
	ROUGHNESS = 0.05;
	SPECULAR = 0.9;
	ALPHA = smoothstep(0.0, 0.35, UV.y) * 0.55;
}
