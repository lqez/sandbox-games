// 덮어 그리는 띠(핏방울·먼지 조각·파편·궁극기 불씨): streak.gdshader와 같이 속도 방향으로 늘이되, 더하지 않고 덮어 그린다.
// 밝은 바닥 위에서 더하기는 무슨 색이든 하얗게 날아가므로, 색을 지켜야 하는 입자는 이것을 쓴다.
// 사각형의 Y는 속도 방향, X는 카메라를 보도록 옆으로 편다.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

uniform vec4 color : source_color = vec4(1.0, 0.85, 0.5, 1.0);

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
	// 앞머리는 조금 밝게(젖은 광택·달아오른 머리)
	ALBEDO = c * mix(1.0, 1.3, along * across * across);
	ALPHA = clamp(a * 1.4, 0.0, 1.0);
}
