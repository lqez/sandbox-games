// 베인 자국(검기 선)과 타격 섬광. 카메라를 보는 사각형 하나로 그린다.
// kind 0: 칼이 지나간 방향으로 길게 그어지는 선(양끝이 가늘고 가운데가 하얗게 달아오른다)
// kind 1: 맞은 자리에서 터지는 별 모양 섬광(가는 빛살 여러 개와 둥근 심)
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled;

uniform vec4 color : source_color = vec4(1.0, 0.85, 0.5, 1.0);
uniform float life = 0.0;        // 0 → 1
uniform int kind = 0;
uniform float energy = 2.2;
uniform float rays = 6.0;
uniform float seed = 0.0;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	vec3 col;
	float a;
	if (kind == 0) {
		// 앞머리가 0.1초 안에 그어지고, 굵기가 줄며 사라진다
		float head = smoothstep(0.0, 0.35, life);
		float along = (p.x + 1.0) * 0.5;
		float drawn = 1.0 - smoothstep(head - 0.08, head, along);
		float taper = 1.0 - pow(abs(p.x), 2.0);
		float width = taper * (1.0 - life * 0.85);
		float core = 1.0 - smoothstep(0.0, max(width * 0.35, 0.001), abs(p.y));
		float glow = 1.0 - smoothstep(0.0, max(width, 0.001), abs(p.y));
		col = mix(color.rgb, vec3(1.0), core) * energy;
		a = (glow * 0.6 + core) * drawn * (1.0 - smoothstep(0.6, 1.0, life));
	} else {
		float r = length(p);
		float ang = atan(p.y, p.x) + seed;
		float spikes = pow(abs(cos(ang * rays * 0.5)), 24.0);
		float spread = 0.25 + life * 0.75;
		float ray = spikes * (1.0 - smoothstep(0.0, spread, r));
		float core = 1.0 - smoothstep(0.0, 0.22 * (1.0 - life), r);
		float ringr = abs(r - life * 0.9);
		float ring = (1.0 - smoothstep(0.0, 0.05, ringr)) * (1.0 - life);
		col = mix(color.rgb, vec3(1.0), core) * energy;
		a = (ray * 0.9 + core + ring * 0.5) * (1.0 - smoothstep(0.5, 1.0, life));
	}
	ALBEDO = col * a;
	ALPHA = clamp(a, 0.0, 1.0);
}
