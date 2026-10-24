// 타격 섬광과 빛선. 카메라를 보는 사각형 하나로 그린다(vfx.gd가 풀에서 돌려 쓴다).
// kind 0: 날 방향으로 길게 그어지는 선(양끝이 가늘고 가운데가 하얗게 달아오른다). 패링·받아치기
// kind 1: 맞은 자리의 섬광. 칼이 가던 쪽(x)으로 stretch배 늘인 하얀 네 뿔 별이 0ms에 터져 50ms에 가늘어지고,
//         그 둘레로 영웅 색 가는 빛살이 안쪽부터 비면서 바깥으로 날아간다. 고리·원판은 그리지 않는다
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled;

uniform vec4 color : source_color = vec4(1.0, 0.85, 0.5, 1.0);
uniform float life = 0.0;        // 0 → 1
uniform int kind = 0;
uniform float energy = 2.2;
uniform float rays = 10.0;       // 가는 빛살 수
uniform float seed = 0.0;
uniform float stretch = 1.7;     // 별을 x(칼이 가던 방향)로 늘이는 배율

float hash(float n) {
	return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// 네 뿔 별: sqrt|x| + sqrt|y| <= 1 (변이 안으로 휜 뾰족한 별)
float star_d(vec2 q) {
	return sqrt(abs(q.x)) + sqrt(abs(q.y));
}

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
		// 1) 하얀 네 뿔 별: 20ms에 다 펼쳐지고, 가늘어지며 55ms(life 0.5)에 사라진다
		float grow = smoothstep(0.0, 0.18, life);
		float thin = smoothstep(0.2, 0.55, life);
		float size = mix(0.6, 0.9, grow) * (1.0 - thin * 0.75);
		vec2 q = vec2(p.x / stretch, p.y) / max(size, 0.01);
		float d = star_d(q);
		float star = (1.0 - smoothstep(0.86, 1.0, d)) * (1.0 - smoothstep(0.35, 0.55, life));
		float star_glow = (1.0 - smoothstep(0.7, 1.7, d)) * 0.3 * (1.0 - smoothstep(0.15, 0.5, life));
		// 2) 영웅 색 가는 빛살: 길이가 제각각이고, 안쪽부터 비면서 바깥으로 날아간다
		float k = floor(ang * rays / 6.2832 + 0.5);
		float len = 0.5 + 0.5 * hash(k);
		float spikes = pow(abs(cos(ang * rays * 0.5)), 36.0);
		float inner = life * 0.8;
		float outer = (0.3 + life * 0.8) * len;
		float ray = spikes * smoothstep(inner, inner + 0.12, r) * (1.0 - smoothstep(outer - 0.25, outer, r))
			* (1.0 - smoothstep(0.55, 0.9, life));
		// 3) 아주 짧은 색 번짐(0ms에만, 35ms 안에 사라져 원판으로 읽히지 않는다)
		float halo = (1.0 - smoothstep(0.0, 0.5, r)) * 0.3 * (1.0 - smoothstep(0.0, 0.3, life));
		a = star + star_glow + ray * 0.95 + halo;
		col = mix(color.rgb, vec3(1.0), clamp(star * 1.3, 0.0, 1.0)) * energy;
	}
	ALBEDO = col * a;
	ALPHA = clamp(a, 0.0, 1.0);
}
