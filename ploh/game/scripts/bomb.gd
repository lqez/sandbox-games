extends RigidBody3D
## 던진 폭탄: 포물선으로 날아가 바닥에 튀고 구르다가 도화선이 다 타면 터진다.
## 반경 안의 적은 피해를 입고 나가떨어지며(래그돌), 소품은 날아가거나 부서지고, 래그돌·조각도 밀려난다. 너무 가까우면 영웅도 다친다

const Fx := preload("res://scripts/fx.gd")
const Vfx := preload("res://scripts/vfx.gd")
const FUSE := 1.1            # 던진 뒤 터지기까지(초)
const RADIUS := 2.8
const DAMAGE := 70.0

var game: Node
var _t := 0.0
var _spark: MeshInstance3D
var _done := false


## from에서 to(바닥의 점)로 sec초에 떨어지도록 던진다
static func throw(g: Node, from: Vector3, to: Vector3, sec := 0.6) -> void:
	var b: RigidBody3D = load("res://scripts/bomb.gd").new()
	b.game = g
	b._build()
	g.world.add_child(b)
	b.global_position = from
	var d := to - from
	var grav := 9.8
	b.linear_velocity = Vector3(d.x / sec, (d.y + 0.5 * grav * sec * sec) / sec, d.z / sec)
	b.angular_velocity = Vector3(randf_range(-6, 6), randf_range(-3, 3), randf_range(-6, 6))


func _build() -> void:
	collision_layer = 4
	collision_mask = 1 | 2 | 16 | 32
	mass = 0.8
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.35
	pm.friction = 0.6
	physics_material_override = pm
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 0.17
	cs.shape = sh
	add_child(cs)
	Fx.part(self, Fx.sphere(0.17), Color(0.16, 0.16, 0.2), Vector3.ZERO)
	Fx.part(self, Fx.cylinder(0.025, 0.025, 0.12, 6), Color(0.7, 0.6, 0.45), Vector3(0, 0.2, 0))
	_spark = Fx.part(self, Fx.sphere(0.05), Color(1.0, 0.65, 0.2), Vector3(0, 0.27, 0), "", 4.0)


func _physics_process(delta: float) -> void:
	if _done:
		return
	_t += delta
	# 도화선 불티가 깜빡이며 점점 빨라진다
	_spark.visible = fmod(_t * (6.0 + 14.0 * _t / FUSE), 1.0) < 0.6
	if _t >= FUSE:
		_explode()


func _explode() -> void:
	_done = true
	var at := global_position
	var ground: float = game.height_at(at.x, at.z)
	game.shake(0.45)
	game.kick(Vector3.UP, 0.015)
	game.sfx("bomb", 0.05, 1.0)
	game.vibrate(80)
	# 폭발 효과(vfx.gd에 explosion이 있으면 그것을, 없으면 불티와 먼지로)
	var vs: Object = load("res://scripts/vfx.gd")
	if vs.get_script_method_list().any(func(m): return m.name == "explosion"):
		vs.call("explosion", game, Vector3(at.x, ground, at.z), RADIUS)
	else:
		game.spark(at, Color(1.0, 0.7, 0.3), Vector3.UP, 30)
		Vfx.dust(game, Vector3(at.x, ground, at.z), Vector3.UP)
	for e in game.enemies.duplicate():
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var d: Vector3 = e.global_position - at
		d.y = 0
		var l := d.length()
		if l > RADIUS + e.radius:
			continue
		var k := clampf(1.0 - l / (RADIUS + e.radius), 0.3, 1.0)
		var dir := d.normalized() if l > 0.05 else Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)).normalized()
		game.bomb_hit(e, DAMAGE * k, dir)
	# 소품·래그돌·조각을 밀어낸다
	var space := get_world_3d().direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	var sph := SphereShape3D.new()
	sph.radius = RADIUS
	q.shape = sph
	q.transform = Transform3D(Basis.IDENTITY, at)
	q.collision_mask = 4 | 8 | 32
	q.exclude = [get_rid()]
	for hit in space.intersect_shape(q, 48):
		var o: Object = hit.collider
		if o is RigidBody3D or o is PhysicalBone3D:
			var body := o as PhysicsBody3D
			var d2: Vector3 = body.global_position - at
			var k2 := clampf(1.0 - d2.length() / RADIUS, 0.0, 1.0)
			var imp := (d2.normalized() + Vector3.UP * 0.8).normalized() * 9.0 * k2
			if o.has_method("hit") and o.get("broken") == false:
				o.hit(d2.normalized(), body.global_position, 1.0)
			if is_instance_valid(o):
				if o is RigidBody3D:
					(o as RigidBody3D).apply_central_impulse(imp * minf((o as RigidBody3D).mass, 20.0) * 0.5)
				else:
					(o as PhysicalBone3D).apply_central_impulse(imp * (o as PhysicalBone3D).mass * 0.6)
	var hero: Node3D = game.player
	if hero != null and hero.global_position.distance_to(at) < RADIUS * 0.6:
		hero.take_damage(DAMAGE * 0.25, at)
	queue_free()
