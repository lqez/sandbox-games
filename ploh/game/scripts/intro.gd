extends Node
## 전투 시작 연출(약 5.6초). 던전에 처음 들어설 때 game.gd가 전투를 멈추고(state = "cutscene") 이것을 튼다.
##
## 1. 세 영웅이 나란히 선 뒷모습 위에서 앞으로 돌아 내려오며 자리 설명(캡션)
## 2. 영웅마다 얼굴을 잡는 짧은 장면: 칼을 들어 막는 자세로 고쳐 서며 한마디(지금 영웅부터)
## 3. 셋을 낮은 각도에서 함께 잡고 "전투 개시" 판이 박힌다
## 4. 판이 화면을 덮는 순간 카메라를 게임으로 돌려주고, 쉬는 두 영웅은 자기 색 빛으로 흩어져 사라진다(교대 대기)
## 0.8초가 지나면 화면을 눌러 건너뛸 수 있다. 시간은 실제 초로 잰다. AUTO에서도 끝까지 틀고 이어서 싸운다.
## 쉬는 두 영웅은 연출용 인형(모델과 대기·막기 동작만)이다. 만화 화면은 comic.gd를 함께 쓴다.

const Comic := preload("res://scripts/comic.gd")
const Fx := preload("res://scripts/fx.gd")
const Vfx := preload("res://scripts/vfx.gd")

const SKIP_AFTER := 0.8
const WIDE := 1.4             # 뒷모습에서 앞으로 돌아 내려오는 길이
const SOLO := 0.95            # 영웅 한 명의 장면 길이
const GROUP := 1.5            # 셋을 함께 잡는 장면(판 포함)
const SPREAD := 1.1           # 옆 영웅과의 간격(m)
## 성격대로 짧게(research/roster.md): 프라우는 제국 8검 출신의 냉정한 검사, 프람은 시원시원한 최전선의 기사,
## 슈나이더는 온화하고 고지식한 수인기사
const LINES := {
	"프라우": "길은 내가 연다.\n따라와!",
	"프람": "좋아,\n정면 돌파다!",
	"슈나이더": "등 뒤는\n제게 맡기세요.",
}
const CAPTION := "갈루스 국경 · 균열의 지하 미궁"

var game: Node
var comic: Control
var camera_on := true
var t := 0.0
var _order: Array = []        # 말하는 순서(파티 번호): 지금 영웅, 그다음 둘
var _who: Dictionary = {}     # 파티 번호 → 몸(지금 영웅은 game.player, 나머지는 인형)
var _puppets: Array = []
var _center := Vector3.ZERO
var _face := Vector3.FORWARD  # 셋이 보는 쪽(첫 방 안쪽)
var _side := Vector3.RIGHT
var _did := {}
var _shot := ""
var _shot_t := 0.0
var _focus_i := -1
var _look := Vector3.INF
var _key: OmniLight3D
var _fov0 := 52.0
var _music_db := -9.0
var _done := false


func start(g: Node) -> void:
	game = g
	var layer: Node = g.hud.get_parent() if g.hud != null and g.hud.get_parent() != null else g
	layer.add_child(self)
	comic = Comic.new()
	comic.game = g
	add_child(comic)
	g.state = "cutscene"
	_fov0 = g.camera.fov
	_music_db = g.music.volume_db
	_key = OmniLight3D.new()
	_key.shadow_enabled = false
	_key.light_energy = 0.0
	g.add_child(_key)
	_stage()


## 셋을 세운다: 지금 영웅이 가운데, 쉬는 둘이 양옆 반걸음 뒤. 모두 첫 방 안쪽을 본다
func _stage() -> void:
	var hero: Node3D = game.player
	_center = hero.global_position
	var r: Dictionary = game.dungeon.rooms[0]
	var to: Vector3 = r.center - _center
	to.y = 0.0
	_face = to.normalized() if to.length() > 0.3 else Vector3(0, 0, -1)
	_side = _face.cross(Vector3.UP).normalized()
	hero.face = _face
	hero.model.rotation.y = atan2(_face.x, _face.z)
	_order = [game.active]
	for i in game.party.size():
		if i != game.active:
			_order.append(i)
	_who[game.active] = hero
	var slot := [-1.0, 1.0]
	var k := 0
	for i in _order.slice(1):
		var p: Vector3 = _center + _side * slot[k] * SPREAD - _face * 0.45
		p.y = game.height_at(p.x, p.z)
		var pup := _puppet(game.party[i])
		game.add_child(pup)
		pup.global_position = p
		pup.rotation.y = atan2(_face.x, _face.z)
		_puppets.append(pup)
		_who[i] = pup
		k += 1


## 연출용 인형: 영웅 모델(그 영웅의 무기만 보이게)에 툰 셰이더를 입히고 대기 동작을 튼다
func _puppet(d: Dictionary) -> Node3D:
	var root := Node3D.new()
	var model: Node3D = load(d.model).instantiate()
	model.scale = Vector3.ONE * d.get("scale", 1.0)
	root.add_child(model)
	var keep: Array = d.get("weapons", [])
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		if mi.name in d.get("hide", []) or (d.has("weapon_pool") and mi.name in d.weapon_pool and not mi.name in keep):
			mi.visible = false
	var mats := Fx.toonify(model, 0.0022)
	Fx.set_param(mats, "aura_color", d.color.lightened(0.15))
	root.add_child(Fx.disc(0.6, Color(0, 0, 0, 0.4)))
	var ap: AnimationPlayer = model.find_children("*", "AnimationPlayer", true, false)[0]
	var idle: String = d.anims.moves.get("idle", "idle")
	if ap.has_animation(idle):
		ap.get_animation(idle).loop_mode = Animation.LOOP_LINEAR
		ap.play(idle)
		ap.seek(randf() * ap.current_animation_length, true)
	root.set_meta("ap", ap)
	root.set_meta("mats", mats)
	var sk: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	root.set_meta("skel", sk)
	root.set_meta("head", sk.find_bone("Head"))
	return root


func _once(key: String) -> bool:
	if _did.has(key):
		return false
	_did[key] = true
	return true


func _valid() -> bool:
	return is_instance_valid(game) and game.state == "cutscene" and game.player != null and is_instance_valid(game.player)


func _process(delta: float) -> void:
	if _done:
		return
	if not _valid():
		_abort()
		return
	var rd := minf(delta / maxf(Engine.time_scale, 0.05), 0.1)
	t += rd
	var hero: Node3D = game.player
	hero.move_input = Vector3.ZERO
	hero.manual_t = 0.0
	_beats()
	if _done:
		return
	_camera(rd)
	_overlay()


func _beats() -> void:
	var solo0 := WIDE
	var group0 := WIDE + SOLO * _order.size()
	if _once("wide"):
		_cut("wide")
		comic.bars_in(0.5)
	if t >= 0.25 and _once("caption"):
		comic.caption(CAPTION)
	if t >= solo0 - 0.15 and _once("caption_out"):
		comic.caption("")
	for n in _order.size():
		var at := solo0 + SOLO * n
		var i: int = _order[n]
		if t >= at and _once("solo%d" % n):
			_cut("solo")
			_focus_i = i
			comic.open(-0.5 if n % 2 == 0 else 0.5)
			game.sfx("glint", 0.1, -6.0 + n)
		if t >= at + 0.1 and _once("say%d" % n):
			var h: Dictionary = game.party[i]
			# 풍선은 머리 위 빈 곳(화면 위쪽)에 두어 얼굴을 가리지 않게 한다
			comic.say("h%d" % i, LINES.get(h.name, "가자!"), "shout" if n == 0 else "talk", _hud(_head(i)), h.color, Vector2(0.5, 0.2))
		if t >= at + SOLO - 0.08 and _once("hush%d" % n):
			comic.hush("h%d" % i)
			if i == game.active:
				game.player.proc.gaze(null)
	if t >= group0 and _once("group"):
		_cut("group")
		_focus_i = -1
		comic.open(0.0)
		for i in _order:
			_ready_pose(i)
	if t >= group0 + 0.35 and _once("title"):
		comic.title("균열의 지하 미궁", "전투 개시", "로드의 기사단 · 프라우 · 프람 · 슈나이더")
		comic.flash(Comic.PAPER, 0.12)
		comic.sfx("챙!", comic.size * Vector2(0.24, 0.3), -0.12, Comic.GOLD, 0.9)
		game.sfx("heavy", 0.0, -2.0)
		game.sfx("glint", 0.0, 0.0)
		game.vibrate(40)
		_handoff()
		_vanish()
	if t >= group0 + GROUP - 0.32 and _once("title_out"):
		comic.title_out()
		comic.bars_out()
	if t >= group0 + GROUP and _once("end"):
		finish()


func _cut(shot: String) -> void:
	_shot = shot
	_shot_t = t
	_look = Vector3.INF


## 칼을 들어 막는 자세로 고쳐 선다(패링 클립의 칼을 들어 올린 자세에서 멈춘다)
func _ready_pose(i: int) -> void:
	var wv: Variant = _who.get(i)
	if wv == null or not is_instance_valid(wv):
		return
	var who: Node3D = wv
	var parry: String = game.party[i].anims.moves.get("parry", "parry")
	if who == game.player:
		if who.anim.has_animation(parry):
			who._play(parry, 2.0, 0.1, true)
			who._snap(parry, [2.0, 0.12, 0.0, 999.0, 0.0])
		return
	var ap: AnimationPlayer = who.get_meta("ap")
	if ap.has_animation(parry) and ap.current_animation != parry:
		ap.play(parry, 0.12)
		ap.speed_scale = 2.0
		var tw := who.create_tween()
		tw.tween_interval(0.12)
		tw.tween_property(ap, "speed_scale", 0.0, 0.06)


## 쉬는 둘은 자기 색 빛으로 흩어져 사라진다(교대를 기다린다)
func _vanish() -> void:
	for k in _puppets.size():
		var pup: Node3D = _puppets[k]
		if not is_instance_valid(pup):
			continue
		var i: int = _order[k + 1]
		var col: Color = game.party[i].color
		var tw := pup.create_tween()
		tw.tween_interval(0.25 + 0.12 * k)
		tw.tween_callback(func():
			Vfx.sparkles(game, pup.global_position + Vector3(0, 1.0, 0), col, 26)
			Fx.set_param(pup.get_meta("mats"), "aura", 1.0))
		tw.tween_property(pup, "scale", Vector3(0.05, 1.3, 0.05), 0.22).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_BACK)
		tw.tween_callback(pup.queue_free)


## 머리 위(말풍선 꼬리·카메라가 볼 점). 인형은 머리 뼈에서 읽는다
func _head(i: int) -> Vector3:
	var who: Variant = _who.get(i)
	if who == null or not is_instance_valid(who):
		return _center + Vector3(0, 2.0, 0)
	if who == game.player:
		return (who as Node3D).head_pos() + Vector3(0, 0.2, 0)
	var sk: Skeleton3D = (who as Node3D).get_meta("skel")
	var hb: int = (who as Node3D).get_meta("head")
	if hb < 0:
		return (who as Node3D).global_position + Vector3(0, 2.0, 0)
	return sk.global_transform * sk.get_bone_global_pose(hb).origin + Vector3(0, 0.2, 0)


func _camera(rd: float) -> void:
	if not camera_on:
		return
	var cam: Camera3D = game.camera
	var up := Vector3.UP
	var pos := Vector3.ZERO
	var want := Vector3.ZERO
	var fov := 44.0
	match _shot:
		"wide":
			# 뒷모습 위에서 옆을 돌아 앞으로 내려온다(천천히 출발해 천천히 선다)
			var k := smoothstep(0.0, 1.0, (t - _shot_t) / WIDE)
			var ang := lerpf(PI * 0.9, PI * 0.15, k)
			var dir := (-_face).rotated(Vector3.UP, ang)
			pos = _center + dir * lerpf(5.5, 4.8, k) + up * lerpf(4.0, 1.8, k)
			want = _center + up * lerpf(1.2, 1.4, k)
			fov = lerpf(48.0, 42.0, k)
			_light(_center + _face * 1.8 + up * 1.6, 4.5, 0.6, Color(1.0, 0.85, 0.7))
		"solo":
			# 말하는 영웅을 비스듬히 앞(얼굴 쪽 35°)에서 가슴 위로, 조금씩 다가서며 잡는다. 바깥쪽에서 들어가 옆 영웅이 가리지 않게
			var k := clampf((t - _shot_t) / SOLO, 0.0, 1.0)
			# 얼굴이 화면 가운데보다 조금 아래에 오게 머리를 보고(풍선 자리를 위에 남긴다), 눈높이보다 조금 낮은 데서 올려다본다
			var hh := _head(_focus_i) - up * 0.3
			# 전투 대기 자세는 왼어깨가 앞으로 나온 옆선이라 가슴과 얼굴이 오른쪽 앞을 본다: 그쪽(캐릭터 오른쪽 앞)에서 잡는다
			var dir := _face.rotated(Vector3.UP, -0.55)
			pos = hh + dir * lerpf(2.6, 2.2, k) - up * 0.15
			want = hh + up * 0.12
			fov = 38.0
			_light(hh + dir * 1.1 + up * 0.2, 3.0, 2.2, Color(1.0, 0.86, 0.7))
			# 지금 영웅은 말할 때 카메라 쪽을 본다
			if _focus_i == game.active:
				game.player.proc.gaze(pos)
		"group":
			# 셋을 앞에서 낮게 올려다본다(조금씩 물러난다)
			var k := clampf((t - _shot_t) / GROUP, 0.0, 1.0)
			pos = _center + _face * lerpf(7.0, 7.6, k) + up * 2.2
			want = _center + up * 0.9
			fov = 50.0
			_light(_center + _face * 2.0 + up * 1.4, 4.5, 1.0, Color(1.0, 0.85, 0.65))
	_look = want if _look == Vector3.INF else _look.lerp(want, 1.0 - exp(-rd * 8.0))
	pos.y = maxf(pos.y, game.height_at(pos.x, pos.z) + 0.4)
	cam.fov = fov
	cam.global_position = pos
	cam.look_at(_look, Vector3.UP)


func _light(at: Vector3, reach: float, energy: float, color: Color) -> void:
	_key.global_position = at
	_key.omni_range = reach
	_key.light_energy = energy
	_key.light_color = color


func _overlay() -> void:
	for i in _order:
		comic.point("h%d" % i, _hud(_head(i)))
	comic.skip_ready = t >= SKIP_AFTER


func _hud(p: Vector3) -> Vector2:
	if game.camera.is_position_behind(p):
		return Vector2.INF
	return game.to_hud(p)


## 판이 덮는 순간 카메라를 게임으로 돌려준다
func _handoff() -> void:
	if not camera_on:
		return
	camera_on = false
	game.camera.fov = _fov0
	game._cam_ready = false
	if is_instance_valid(_key):
		_key.light_energy = 0.0


func _input(event: InputEvent) -> void:
	if _done:
		return
	if event is InputEventScreenTouch or event is InputEventScreenDrag or event is InputEventKey or event is InputEventMouseButton:
		get_viewport().set_input_as_handled()
	var press: bool = (event is InputEventScreenTouch or event is InputEventMouseButton or (event is InputEventKey and not event.echo)) and event.pressed
	if press:
		# 웹은 첫 터치에서야 소리를 낼 수 있다: 건너뛰는 누름에서 박자 음악을 시작한다
		game.start_music()
		if t >= SKIP_AFTER:
			finish()


func finish() -> void:
	if _done:
		return
	_done = true
	_handoff()
	for pup in _puppets:
		if is_instance_valid(pup):
			pup.queue_free()
	var hero: Node3D = game.player
	if is_instance_valid(hero) and hero.state == "idle":
		hero._play(hero._anim("idle"), 1.0, 0.25, true)
	_restore()


func _abort() -> void:
	_done = true
	for pup in _puppets:
		if is_instance_valid(pup):
			pup.queue_free()
	_restore()


func _restore() -> void:
	camera_on = false
	if is_instance_valid(_key):
		_key.queue_free()
	if comic != null:
		comic.cleanup()
	if is_instance_valid(game):
		game.camera.fov = _fov0
		if game.state == "cutscene":
			game.state = "play"
		var hud: Control = game.hud
		if hud != null:
			hud.modulate.a = 0.0
			var tw := hud.create_tween()
			tw.set_ignore_time_scale(true)
			tw.tween_property(hud, "modulate:a", 1.0, 0.45)
	queue_free()
