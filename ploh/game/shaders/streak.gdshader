// 날아가는 불꽃·핏방울을 속도 방향으로 늘인 띠로 그린다(CPUParticles3D의 align_y로 Y축이 속도를 따른다).
// 사각형의 Y는 속도 방향, X는 카메라를 보도록 옆으로 편다.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.85, 0.5, 1.0);
uniform float energy = 2.5;

void vertex() {
	vec3 center = MODEL_MATRIX[3].xyz;
	vec3 axis = MODEL_MATRIX[1].xyz;
	vec3 to_cam = normalize(CAMERA_POSITION_WORLD - center);
	vec3 side = cross(axis, to_cam);
	float sl = length(side);
	side = sl > 0.0001 ? side / sl * length(MODEL_MATRIX[0].xyz) : MODEL_MATRIX[0].xyz;
	vec3 world = center + axis * VERTEX.y + side * VERTEX.x;
	POSITION = PROJECTION_MATRIX * VIEW_MATRIX * vec4(world, 1.0);
}

void fragment() {
	float across = 1.0 - abs(UV.x * 2.0 - 1.0);
	// 앞머리(UV.y 0)가 가장 밝고 꼬리로 갈수록 옅다
	float along = 1.0 - UV.y;
	float a = smoothstep(0.0, 0.7, across) * mix(0.25, 1.0, along) * COLOR.a;
	vec3 c = color.rgb * COLOR.rgb;
	ALBEDO = mix(c, vec3(1.0), along * across * 0.5) * energy * a;
	ALPHA = clamp(a, 0.0, 1.0);
}
