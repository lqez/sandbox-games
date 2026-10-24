extends Node3D
## 궁병의 화살. 곧게 날아가며 영웅의 몸(세로 캡슐)을 지나면 맞힌다.
## 영웅이 받아 내면(패링) 쏜 궁병 쪽으로 되튕겨 적을 맞히고, 벽에 닿으면 박혀 사라진다.

const Fx := preload("res://scripts/fx.gd")
const Vfx := preload("res://scripts/vfx.gd")
const SPEED := 19.0          # ART_TARGET 5.2: 18~22 m/s
const LIFE := 2.2

var game: Node
var shooter: Node3D
var dmg := 10.0
var vel := Vector3.ZERO
var friendly := false        # 되튕겨 적을 노리는 중
var _age := 0.0
var _dead := false


static func make(g: Node, from: Vector3, to: Vector3, who: Node3D, damage: float) -> Node3D:
	var a: Node3D = load("res://scripts/arrow.gd").new()
	a.game = g
	a.shooter = who
	a.dmg = damage
	a.vel = (to - from).normalized() * SPEED
	g.add_child(a)
	a.global_position = from
	a._build()
	a._orient()
	return a


func _build() -> void:
	var shaft := Fx.part(self, Fx.box(0.025, 0.025, 0.75), Color(0.92, 0.9, 0.86), Vector3(0, 0, -0.1), "", 0.4)
	shaft.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var head := Fx.part(self, Fx.cylinder(0.0, 0.035, 0.12, 4), Color(0.75, 0.75, 0.8), Vector3(0, 0, 0.32), "", 0.4)
	head.rotation.x = PI / 2
	var fl := Fx.part(self, Fx.box(0.09, 0.005, 0.14), Color(0.85, 0.82, 0.75), Vector3(0, 0, -0.42))
	fl.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# 날아가는 줄기가 잘 보이도록 0.9m 주황-빨강 빛 꼬리(예고색과 같은 계열: 적의 공격, ART_TARGET 5.2).
	# 십자로 세운 띠 두 장을 한 면(그리기 호출 1개)에 넣어 어느 각도에서도 보이고, 촉 쪽이 밝고 넓다가 꼬리로 가늘어지며 사라진다
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for axis in [Vector3(0, 1, 0), Vector3(1, 0, 0)]:
		var a: Vector3 = axis
		# [z 위치, 반너비, 알파]: 촉 뒤 0.1m에서 시작해 0.9m 뒤에서 0으로
		var pts: Array = [[-0.1, 0.03, 1.0], [-0.35, 0.045, 0.75], [-0.65, 0.03, 0.35], [-1.0, 0.008, 0.0]]
		for i in pts.size() - 1:
			var p: Array = pts[i]
			var q: Array = pts[i + 1]
			var v := [[Vector3(0, 0, p[0]) + a * p[1], p[2]], [Vector3(0, 0, p[0]) - a * p[1], p[2]],
					[Vector3(0, 0, q[0]) - a * q[1], q[2]], [Vector3(0, 0, q[0]) + a * q[1], q[2]]]
			for tri in [[0, 1, 2], [0, 2, 3]]:
				for k in tri:
					st.set_color(Color(1.0, 0.45, 0.2, v[k][1]))
					st.add_vertex(v[k][0])
	var tail := MeshInstance3D.new()
	tail.mesh = st.commit()
	var tm := StandardMaterial3D.new()
	tm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	tm.cull_mode = BaseMaterial3D.CULL_DISABLED
	tm.vertex_color_use_as_albedo = true
	tm.albedo_color = Color(1.0, 0.75, 0.5)   # 정점 색(주황-빨강)에 곱해 촉 쪽은 밝은 주황, 꼬리는 빨강으로
	tail.material_override = tm
	tail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	tail.name = "tail"
	add_child(tail)


func _orient() -> void:
	if vel.length() > 0.01:
		look_at(global_position + vel, Vector3.UP)
		rotate_object_local(Vector3.UP, PI)   # 메시는 +Z가 촉


## p(바닥 높이의 몸 위치)까지 닿는 데 남은 시간. 비껴 가면 -1
func time_to(p: Vector3) -> float:
	if _dead or friendly:
		return -1.0
	var d := Vector3(p.x, global_position.y, p.z) - global_position
	var dir := vel.normalized()
	var along := d.dot(dir)
	if along < 0.0:
		return -1.0
	if (d - dir * along).length() > 0.9:
		return -1.0
	return along / vel.length()


func _physics_process(delta: float) -> void:
	if _dead:
		return
	_age += delta
	if _age > LIFE:
		queue_free()
		return
	var from := global_position
	var to := from + vel * delta
	global_position = to
	# 벽에 박힌다
	if game.dungeon != null and game.dungeon.sdf(Vector2(to.x, to.z)) > 0.15:
		_stick()
		return
	if friendly:
		for e in game.enemies:
			if is_instance_valid(e) and e.state != "dead" and _passes(from, to, e.global_position, e.radius + 0.2, 2.0 * e.stats.scale):
				game.hit_enemy(e, dmg * 3.0, game.player, true, "되받아치기", 0.6)
				queue_free()
				return
		return
	var hero: Node3D = game.player
	if hero == null or hero.state == "dead":
		return
	if _passes(from, to, hero.global_position, 0.45, 1.9):
		var to_a: Vector3 = from - hero.global_position
		to_a.y = 0
		if hero.parrying() and hero.face.dot(to_a.normalized()) > -0.2:
			_deflect()
			return
		game.arrow_hit(self)
		queue_free()


## 이번 틱의 비행 선분이 세로 캡슐(바닥 base, 반지름 r, 높이 h)을 지났는지
func _passes(a: Vector3, b: Vector3, base: Vector3, r: float, h: float) -> bool:
	for i in 4:
		var p := a.lerp(b, i / 3.0)
		if p.y < base.y - 0.1 or p.y > base.y + h:
			continue
		if Vector2(p.x - base.x, p.z - base.z).length() <= r:
			return true
	return false


## 받아 냈다: 쏜 궁병 쪽으로 더 빠르게 되튕긴다
func _deflect() -> void:
	friendly = true
	_age = 0.0
	var back := -vel
	if shooter != null and is_instance_valid(shooter) and shooter.state != "dead":
		back = shooter.global_position + Vector3(0, 1.2 * shooter.stats.scale, 0) - global_position
	vel = back.normalized() * SPEED * 1.4
	_orient()
	game.parried_arrow(self)


func _stick() -> void:
	_dead = true
	global_position -= vel.normalized() * 0.15
	var tw := create_tween()
	tw.tween_interval(1.2)
	tw.tween_property(self, "scale", Vector3.ONE * 0.01, 0.3)
	tw.tween_callback(queue_free)
