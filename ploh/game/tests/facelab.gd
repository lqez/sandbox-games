extends Node3D
## 개발용: 영웅 모델 하나를 빈 무대에 세워 얼굴을 세 가지로 찍는다(왼쪽부터 툰+외곽선, 툰만, 표준 재질)
const Fx := preload("res://scripts/fx.gd")
var t := 0.0
var models: Array = []
func _ready() -> void:
	var cam := Camera3D.new()
	cam.fov = 30.0
	add_child(cam)
	cam.position = Vector3(0, 1.4, 4.0)
	cam.look_at(Vector3(0, 1.1, 0))
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.6, 0.4, 0)
	sun.light_energy = 1.0
	add_child(sun)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.4, 0.42, 0.48)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.5, 0.5, 0.55)
	e.ambient_light_energy = 0.6
	env.environment = e
	add_child(env)
	var path: String = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "res://assets/astrid/B_mid/astrid.glb"
	for k in 3:
		var m: Node3D = load(path).instantiate()
		m.scale = Vector3.ONE * 1.6
		add_child(m)
		m.position = Vector3((k - 1) * 1.3, 0, 0)
		m.rotation.y = 0.35 + k * 2.1
		var mats := Fx.toonify(m, 0.0022)
		# 0: 외곽선 그대로, 1: 외곽선 두께 0(같은 자리에 그린다), 2: 외곽선 끔
		for mt in mats:
			mt.next_pass = null
		var ap: AnimationPlayer = m.find_children("*", "AnimationPlayer", true, false)[0]
		ap.play("idle")
		models.append(m)
func _process(delta: float) -> void:
	t += delta
	if t > 0.5:
		get_tree().quit()
