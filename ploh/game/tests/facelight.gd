extends Node
## 개발용: 영웅 얼굴이 왜 어둡게 나오는지 조명을 바꿔 가며 찍는다(0~1초 그대로, 1~2초 달빛 그림자 끔, 2~3초 정면 조명 강하게, 3~4초 툰 그늘색 밝게)
const Game := preload("res://main.tscn")
var boot: Node
var g: Node
var cam: Camera3D
var light: OmniLight3D
var t := 0.0
func _ready() -> void:
	boot = Game.instantiate()
	add_child(boot)
func _process(delta: float) -> void:
	t += delta
	if t > 4.2:
		get_tree().quit()
		return
	if g == null:
		g = boot.game
		return
	var p: Node3D = g.player
	if p == null:
		return
	if cam == null:
		for x in g.enemies:
			if is_instance_valid(x):
				x.queue_free()
		g.enemies.clear()
		cam = Camera3D.new()
		cam.fov = 34.0
		g.add_child(cam)
		cam.current = true
		light = OmniLight3D.new()
		light.omni_range = 3.0
		light.light_energy = 0.0
		g.add_child(light)
	var fwd: Vector3 = p.model.global_transform.basis.z.normalized()
	var head: Vector3 = p.head_pos()
	var dir := fwd.rotated(Vector3.UP, -0.55)
	cam.global_position = head + dir * 1.6 - Vector3(0, 0.15, 0)
	cam.look_at(head - Vector3(0, 0.1, 0))
	# 1초 뒤 외곽선(next_pass)을 끈다
	if t > 2.0 and not has_meta("ol"):
		set_meta("ol", true)
		for m in p.mats:
			m.next_pass = null
	p.manual_t = 0.0
	p.move_input = Vector3.ZERO
	print("%.2f moon_shadow=%s light=%.1f env_ambient=%.2f moon=%.2f" % [t, str(g.moon.shadow_enabled), light.light_energy, g.get_node_or_null("WorldEnvironment").environment.ambient_light_energy if g.get_node_or_null("WorldEnvironment") else -1.0, g.moon.light_energy])
func Fx_set(p, k, v):
	for m in p.mats:
		m.set_shader_parameter(k, v)
