extends Node3D
## 개발용: 초상화용 얼굴 렌더(정면 3/4, 머리가 화면 가운데, 회색 배경 223·224·226). tools/ui/make_portraits.py가 자른다
## 실행: Godot --path ploh/game --position 4000,4000 --write-movie <폴더>/f.png --fixed-fps 30 --resolution 1024x1024 res://tests/portrait.tscn -- <glb 경로> <머리 뼈 이름> <머리 위 여유 m>
const Fx := preload("res://scripts/fx.gd")
var t := 0.0
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var path: String = args[0] if args.size() > 0 else "res://assets/astrid/B_mid/astrid.glb"
	var head_name: String = args[1] if args.size() > 1 else "Head"
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(223 / 255.0, 224 / 255.0, 226 / 255.0)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.6, 0.6, 0.66)
	e.ambient_light_energy = 0.7
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.55, 0.6, 0)
	sun.light_energy = 1.1
	add_child(sun)
	var m: Node3D = load(path).instantiate()
	m.scale = Vector3.ONE * 1.6
	add_child(m)
	var mats := Fx.toonify(m, 0.0)
	var ap: AnimationPlayer = m.find_children("*", "AnimationPlayer", true, false)[0]
	# 쉬는 자세(머리를 똑바로 든 A자세)로 찍는다
	ap.stop()
	ap.active = false
	var sk: Skeleton3D = m.find_children("*", "Skeleton3D", true, false)[0]
	sk.force_update_all_bone_transforms()
	var hb := sk.find_bone(head_name)
	var hg := sk.get_bone_global_pose(hb)
	var head: Vector3 = sk.global_transform * hg.origin + Vector3(0, 0.15, 0)
	# 머리 뼈가 실제로 보는 쪽에서 왼쪽 앞 30°로 돌아 눈높이보다 조금 위에서 본다
	var fwd: Vector3 = sk.global_transform.basis * (hg.basis * sk.get_bone_global_rest(hb).basis.inverse() * Vector3(0, 0, 1))
	fwd.y = 0.0
	var dir := fwd.normalized().rotated(Vector3.UP, deg_to_rad(30.0))
	var cam := Camera3D.new()
	cam.fov = 28.0
	add_child(cam)
	cam.global_position = head + dir * 1.7 + Vector3(0, 0.02, 0)
	cam.look_at(head, Vector3.UP)
	# 얼굴 조명
	var key := OmniLight3D.new()
	key.omni_range = 3.0
	key.light_energy = 1.2
	add_child(key)
	key.global_position = head + dir * 1.0 + Vector3(0.3, 0.3, 0)
func _process(delta: float) -> void:
	t += delta
	if t > 0.2:
		get_tree().quit()
