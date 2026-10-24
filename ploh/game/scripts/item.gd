extends RigidBody3D
## 줍는 아이템(폭탄, 회복약, 금화). 상자에서 튀어나와 바닥에 구르다가, 영웅이 가까이 오면 빨려 들어가 가방에 들어간다.
## 가방에 든 폭탄·회복약은 화면 왼쪽 아래 버튼으로 쓴다(자동 전투는 알아서 쓴다)

const Fx := preload("res://scripts/fx.gd")
const MAGNET := 2.2          # 이 거리 안에 영웅이 오면 빨려 간다(m)
## 종류: 이름, 색, 상자에서 나올 비중(보물상자는 rich)
const KINDS := {
	"bomb": {"name": "폭탄", "color": Color(0.16, 0.16, 0.2), "w": 3.0, "rich": 4.0},
	"potion": {"name": "회복약", "color": Color(0.9, 0.2, 0.25), "w": 2.5, "rich": 3.0},
	"gold": {"name": "금화", "color": Color(1.0, 0.8, 0.25), "w": 3.0, "rich": 3.0},
}

var game: Node
var kind := "gold"
var _age := 0.0
var _taken := false


## 부서진 상자에서 나올 것(없으면 ""). rich는 보물상자
static func roll(rich: bool) -> String:
	if not rich and randf() < 0.35:
		return ""
	var tot := 0.0
	for k in KINDS:
		tot += KINDS[k].rich if rich else KINDS[k].w
	var r := randf() * tot
	for k in KINDS:
		r -= KINDS[k].rich if rich else KINDS[k].w
		if r <= 0.0:
			return k
	return "gold"


static func drop(g: Node, at: Vector3, dir: Vector3, k: String) -> void:
	if k == "":
		return
	var it: RigidBody3D = load("res://scripts/item.gd").new()
	it.game = g
	it.kind = k
	it._build()
	g.world.add_child(it)
	it.global_position = at
	dir.y = 0
	it.apply_central_impulse((dir.normalized() * randf_range(1.0, 2.0) + Vector3.UP * randf_range(2.5, 3.5)) * it.mass)
	it.apply_torque_impulse(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.02)


func _build() -> void:
	collision_layer = 4
	collision_mask = 1 | 2 | 16 | 32
	mass = 0.4
	var c: Color = KINDS[kind].color
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 0.16
	cs.shape = sh
	add_child(cs)
	match kind:
		"bomb":
			var b := Fx.part(self, Fx.sphere(0.17), c, Vector3.ZERO, "", 0.0)
			b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			Fx.part(self, Fx.cylinder(0.025, 0.025, 0.12, 6), Color(0.7, 0.6, 0.45), Vector3(0, 0.2, 0))
			# 도화선 불티
			Fx.part(self, Fx.sphere(0.035), Color(1.0, 0.6, 0.2), Vector3(0, 0.27, 0), "", 3.0)
		"potion":
			Fx.part(self, Fx.sphere(0.13), c, Vector3(0, -0.02, 0), "", 0.8)
			Fx.part(self, Fx.cylinder(0.04, 0.05, 0.12, 8), Color(0.85, 0.9, 0.95), Vector3(0, 0.15, 0))
			Fx.part(self, Fx.cylinder(0.045, 0.045, 0.04, 8), Color(0.55, 0.35, 0.2), Vector3(0, 0.22, 0))
		_:
			var coin := Fx.part(self, Fx.cylinder(0.14, 0.14, 0.03, 14), c, Vector3.ZERO, "", 1.2)
			coin.rotation.x = PI / 2
	# 바닥에 떨어져 있어도 보이게 살짝 빛나는 받침
	var glow := Fx.part(self, Fx.sphere(0.24), Color(c.lightened(0.5), 0.16), Vector3.ZERO, "", 1.5)
	(glow.material_override as StandardMaterial3D).transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	(glow.material_override as StandardMaterial3D).blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	(glow.material_override as StandardMaterial3D).shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func _physics_process(delta: float) -> void:
	_age += delta
	if _taken or game == null:
		return
	if _age > 40.0:
		queue_free()
		return
	var hero: Node3D = game.player
	if hero == null or not is_instance_valid(hero) or hero.state == "dead" or _age < 0.6:
		return
	var to: Vector3 = hero.global_position + Vector3(0, 0.9, 0) - global_position
	var d := to.length()
	if d < 0.45:
		_take()
	elif d < MAGNET:
		# 빨려 간다(가까울수록 빠르게)
		freeze = true
		global_position += to.normalized() * minf(d, delta * (4.0 + 10.0 * (1.0 - d / MAGNET)))


func _take() -> void:
	_taken = true
	game.add_item(kind)
	var tw := create_tween()
	tw.tween_property(self, "scale", Vector3.ONE * 1.6, 0.06)
	tw.tween_property(self, "scale", Vector3.ONE * 0.01, 0.1)
	tw.tween_callback(queue_free)
