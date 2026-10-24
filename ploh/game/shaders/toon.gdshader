// 카툰 렌더링: 두 단계 명암, 부드러운 경계, 림라이트, 피격·강조 플래시.
// 원작(카툰 렌더링 3D)의 인상에 맞춘다. 외곽선은 outline.gdshader를 next_pass로 붙인다.
shader_type spatial;
render_mode diffuse_toon, specular_toon;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform bool use_tex = true;
uniform vec4 albedo : source_color = vec4(1.0);
uniform vec4 shade_tint : source_color = vec4(0.62, 0.58, 0.82, 1.0);  // 그늘 색(보랏빛)
uniform float shade_edge : hint_range(0.0, 1.0) = 0.42;
uniform float shade_soft : hint_range(0.0, 0.5) = 0.06;
uniform vec4 rim_color : source_color = vec4(1.0, 0.92, 0.8, 1.0);
uniform float rim_amount : hint_range(0.0, 1.0) = 0.16;
uniform float flash : hint_range(0.0, 1.0) = 0.0;                    // 피격 하양
uniform vec4 glow_color : source_color = vec4(1.0, 0.85, 0.4, 1.0);
uniform float glow : hint_range(0.0, 1.0) = 0.0;
uniform float saturation : hint_range(0.0, 1.0) = 1.0;               // 배경 소품은 낮춰서 차분하게
uniform vec4 aura_color : source_color = vec4(1.0, 0.8, 0.4, 1.0);
uniform float aura : hint_range(0.0, 1.0) = 0.0;                     // 궁극기로 몸이 강화된 동안 윤곽이 빛난다

void fragment() {
	vec4 c = use_tex ? texture(albedo_tex, UV) * albedo : albedo;
	c.rgb = mix(vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114))), c.rgb, saturation);
	ALBEDO = c.rgb;
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	// 글로우는 몸 전체가 아니라 윤곽(림)에만 실어 실루엣이 달아오르게 한다
	float rim2 = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0);
	EMISSION = rim_color.rgb * rim * rim_amount + glow_color.rgb * glow * rim * 2.5 + vec3(flash) * 0.6
		+ aura_color.rgb * (rim2 * 2.4 + 0.08) * aura;
	ROUGHNESS = 1.0;
	SPECULAR = 0.15;
}

void light() {
	float ndl = dot(NORMAL, LIGHT);
	float lit = smoothstep(shade_edge - shade_soft, shade_edge + shade_soft, ndl * 0.5 + 0.5);
	float shadow = mix(0.0, 1.0, ATTENUATION);
	float k = lit * shadow;
	vec3 tint = mix(shade_tint.rgb, vec3(1.0), k);
	DIFFUSE_LIGHT += ALBEDO * tint * LIGHT_COLOR / PI * 1.0;
}
