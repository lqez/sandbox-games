extends Node
## 보스 등장 연출(약 8.5초). 마지막 방에 처음 들어서면 game.gd가 전투를 멈추고(state = "cutscene") 이것을 튼다.
##
## 1. 붉은 융단을 따라 낮고 느리게 옥좌로 다가간다. 보스는 앉아서 지루한 듯 바닥을 내려다본다
## 2. 보스의 첫 대사(말풍선)
## 3. 무겁게 일어서고, 무기가 바닥을 찍는 순간 화면이 흔들린다(쿵!)
## 4. 영웅을 노려보는 클로즈업: 정지 화면 고대비 임팩트 프레임, 집중선, 효과음 글자(두둥!), 차가운 한마디
## 5. 지금 영웅의 대답
## 6. 보스 이름판. 이름판이 화면을 덮는 순간 카메라를 게임으로 돌려주고, 이름판이 빠지면 싸움이 시작된다
## 1초가 지나면 화면을 눌러 건너뛸 수 있다. 시간은 슬로모션·히트스톱과 무관한 실제 초로 잰다.
## AUTO에서도 끝까지 틀고 이어서 싸운다.
##
## 옥좌: dungeon.throne({pos: 방석 윗면, stand: 일어서 설 자리, face: 옥좌가 보는 쪽})이 있으면 그 자리, 없으면 들어온 길 반대편 벽 앞에서
## 입구를 본다. 보스는 방석 아래 단 위에 앉았다가 일어서며 stand로 나선다.
## 동작: 보스 모델에 throne_sit(앉은 루프)·throne_rise(일어서 전투 대기)가 있으면 그것을, 없으면 대기 동작에
## 절차적 웅크림으로 앉히고 내려찍기(attack_1)의 뒷부분으로 일어서며 바닥을 찍게 한다.
## 연출 노드는 HUD와 같은 CanvasLayer에 HUD 다음으로 붙는다: HUD보다 먼저 입력을 받아 막고, HUD 다음에 돌아
## 영웅의 이동 입력을 비운다. 만화 화면은 자식 comic.gd가 그린다.

const Comic := preload("res://scripts/comic.gd")
const Vfx := preload("res://scripts/vfx.gd")

const SKIP_AFTER := 1.0       # 이만큼 지나야 눌러서 건너뛸 수 있다
const SHOT_A := 1.85          # 융단을 따라 다가가는 길이
const SAY_SEATED := 0.15      # 옥좌 장면이 시작하고 첫 대사까지
const RISE_AT := 1.2          # 옥좌 장면이 시작하고 일어서기까지
const AFTER_HIT := 0.5        # 무기가 바닥을 찍은 뒤 클로즈업까지
const SHOT_C := 1.4           # 노려보는 클로즈업 길이
const IMPACT := 0.3           # 그중 정지 화면(고대비) 길이
const SHOT_D := 1.45          # 영웅의 대답 길이
const TITLE := 1.4            # 이름판 길이
const SEAT_DROP := 0.24       # throne_sit이 없을 때 앉은 자세 대신 골반을 방석 높이로 내리는 깊이(m, 모델 크기 1 기준)
const SEAT_FWD := 0.25        # 그때 방석 앞쪽에 걸터앉게 몸을 이만큼 앞에 둔다(등이 등받이에 묻히지 않게)
const RISE_UP := 0.55         # 웅크림을 펴는 시간
const STEP_OUT := 0.7         # 일어서며 옥좌 앞(stand)으로 나서는 시간
## throne_rise가 없을 때: 내려찍기(attack_1)를 이 위치(초)부터 이 속도로 틀고, 이 위치에서 무기가 바닥에 닿는다(README 타격 52프레임)
const SLAM := {"clip": "attack_1", "from": 1.15, "speed": 1.0, "hit": 1.733}
const RISE_HIT := 0.8         # throne_rise에서 무기가 바닥에 닿는 위치(클립 길이 비율)
const EYE := Vector3(0.065, 0.12, 0.16)   # 머리 뼈에서 드러난 왼눈까지(모델 공간 m: +X 왼쪽, +Z 앞). _overlay가 머리 뼈 위치를 더한다
const HERO_GAP := 7.5         # 영웅을 세울 자리: 옥좌에서 융단을 따라 이만큼(m)
## 대사. 조슈아는 의욕 없는 존댓말(design/enemies/ROSTER.md 6장 대사 톤: "…명령이니까요. 빨리 끝내죠. 퇴근하고 싶거든요.").
## 영웅은 성격대로 짧게 받아친다(research/roster.md)
const BOSS := {"kicker": "제국의 여덟 검", "name": "조슈아 레비턴스", "sub": "갈루스 제국 집행부 특임대장"}
const LINE_SEATED := "…하필\n퇴근 직전이네요."
const LINE_GLARE := "명령이니까요.\n빨리 끝내죠."
const REPLY := {
	"프라우": "오늘은 야근이야,\n조슈아!",           # 같은 8검 출신, 심심하면 시비를 걸던 사이
	"프람": "퇴근은 날\n쓰러뜨리고 해!",             # 시원시원한 불꽃의 용병
	"슈나이더": "기사의 이름으로,\n상대하겠습니다!",   # 온화하고 고지식한 수인기사
}
const CAPTION := "균열의 지하 미궁, 최심부"

var game: Node
var comic: Control
var camera_on := true         # game._update_camera는 이 동안 카메라를 넘겨준다
var room := -1
var boss: Node3D
var guards: Array = []
var t := 0.0
var _dungeon: RefCounted
var _seat := Vector3.ZERO     # 옥좌 방석 아래 단 윗면(보스 발 높이)
var _sit := Vector3.ZERO      # 앉아 있는 동안 보스 몸(발) 자리
var _stand := Vector3.ZERO    # 일어서 설 자리(옥좌 앞 단 위)
var _face := Vector3.FORWARD  # 옥좌가 보는 쪽(입구, 융단이 뻗는 쪽)
var _side := Vector3.RIGHT
var _mark := Vector3.ZERO     # 영웅을 세운 자리
var _at := {}                 # 장면·사건의 시작 시각
var _did := {}
var _shot := ""
var _shot_t := 0.0            # 지금 장면이 시작한 시각
var _shot_frames := 0
var _look := Vector3.ZERO     # 카메라가 보는 점(머리를 부드럽게 따라간다)
var _close := Vector3.ZERO    # 클로즈업을 잡은 순간의 보스 머리
var _shake := 0.0
var _key: OmniLight3D         # 연출용 얼굴 조명(장면마다 옮긴다). 던전 조명만으로는 입구를 보는 얼굴이 그늘에 묻힌다
var _slam := false            # throne_rise가 없어 내려찍기로 대신한다
var _fov0 := 52.0
var _music_db := -9.0
var _done := false


## 보스 방(i)에 들어섰다: 전투를 멈추고 무대를 꾸민다(옥좌의 보스, 양옆 호위, 융단 끝의 영웅)
func start(g: Node, i: int) -> void:
	game = g
	room = i
	_dungeon = g.dungeon
	var layer: Node = g.hud.get_parent() if g.hud != null and g.hud.get_parent() != null else g
	layer.add_child(self)
	comic = Comic.new()
	comic.game = g
	add_child(comic)
	g.state = "cutscene"
	_key = OmniLight3D.new()
	_key.shadow_enabled = false
	_key.light_energy = 0.0
	g.add_child(_key)
	_fov0 = g.camera.fov
	_music_db = g.music.volume_db
	g.music.volume_db = _music_db - 8.0
	for e in g.dormant.get(i, []):
		if not is_instance_valid(e):
			continue
		if e.kind == "boss":
			boss = e
		else:
			guards.append(e)
	if boss == null:
		finish()
		return
	_stage()
	# 시각표: 일어서기 길이는 클립에 맞춘다
	_at.B = SHOT_A
	_at.rise = _at.B + RISE_AT
	if boss.anim.has_animation("throne_rise"):
		_at.hit = _at.rise + boss.anim.get_animation("throne_rise").length * RISE_HIT
	else:
		_slam = true
		_at.hit = _at.rise + (SLAM.hit - SLAM.from) / SLAM.speed
	_at.C = _at.hit + AFTER_HIT
	_at.D = _at.C + SHOT_C
	_at.title = _at.D + SHOT_D
	_at.end = _at.title + TITLE


## 옥좌 자리를 정하고 보스를 앉힌다. 호위는 옥좌 양옆, 영웅은 융단 끝에서 옥좌를 보고 선다
func _stage() -> void:
	var d: RefCounted = game.dungeon
	var r: Dictionary = d.rooms[room]
	var th = d.get("throne")
	if th is Dictionary and th.has("pos"):
		# pos는 방석 윗면(엉덩이 자리), stand는 옥좌 앞 단 위에서 일어서 설 자리
		_seat = th.pos
		_face = th.get("face", r.center - th.pos)
		_stand = th.get("stand", _seat + _face.normalized() * 1.15)
	else:
		# 옥좌가 아직 없으면 들어온 길 반대편 벽 앞(방 가장자리까지의 62%)에서 입구를 본다
		var prev: Vector3 = d.rooms[maxi(room - 1, 0)].center
		var away: Vector3 = r.center - prev
		away.y = 0.0
		away = away.normalized() if away.length() > 0.01 else Vector3(0, 0, -1)
		var q := Vector2(away.x, away.z).rotated(-r.rot)
		var reach := 1.0 / Vector2(q.x / r.rx, q.y / r.rz).length()
		_seat = r.center + away * reach * 0.62
		_face = -away
		_stand = _seat - away * 1.15
	_face.y = 0.0
	_face = _face.normalized() if _face.length() > 0.01 else Vector3(0, 0, 1)
	_side = _face.cross(Vector3.UP).normalized()
	# 이제부터 _seat는 방석 아래 단 윗면(보스 발 높이)이다. 카메라 구도도 여기를 기준으로 잡는다
	_seat.y = game.height_at(_seat.x, _seat.z)
	_stand.y = game.height_at(_stand.x, _stand.z)
	# 보스: 옥좌에 앉아(무적) 지루한 듯 앞 바닥을 내려다본다. 앉은 클립이 없으면 방석 앞쪽에 걸터앉도록 조금 앞에 두고 웅크린다
	var clip: bool = boss.anim.has_animation("throne_sit")
	_sit = _seat + _face * (0.0 if clip else SEAT_FWD)
	boss.throne = true
	boss.visible = true
	boss.anim.active = true
	boss.proc.active = true
	boss.global_position = _sit
	boss.look_toward(_sit + _face)
	if clip:
		boss.anim.get_animation("throne_sit").loop_mode = Animation.LOOP_LINEAR
		boss._play("throne_sit", 1.0, 0.0, true)
	else:
		boss._play("idle", 0.55, 0.0, true)
		boss.proc.crouch = SEAT_DROP
	boss.proc.gaze(_stand + _face * 2.0 + Vector3(0, 0.2, 0))
	# 호위: 제단 앞, 융단 양옆에서 입구를 본다
	for k in guards.size():
		var e: Node3D = guards[k]
		var p := _seat + _face * (3.2 + (k / 2) * 1.6) + _side * (-1.0 if k % 2 == 0 else 1.0) * 2.6
		if d.sdf(Vector2(p.x, p.z)) < -0.8:
			p.y = game.height_at(p.x, p.z)
			e.global_position = p
			e.look_toward(p + _face)
	# 영웅: 융단 끝(방 안쪽으로 들어온 자리)에 세워 옥좌를 보게 한다. 첫 장면이 바로 바뀌므로 자리를 옮겨도 튀어 보이지 않는다
	var gap := HERO_GAP
	while gap > 3.5 and d.sdf(Vector2(_seat.x + _face.x * gap, _seat.z + _face.z * gap)) > -1.0:
		gap -= 0.5
	_mark = _seat + _face * gap
	_mark.y = game.height_at(_mark.x, _mark.z)
	var hero: Node3D = game.player
	# 옮기기 전에 칼 궤적·검기와 칼날 판정을 끊는다(옛 자리와 새 자리를 잇는 긴 궤적이 생기지 않게)
	if hero.state not in ["idle", "dead"] and hero.has_method("_to_idle"):
		hero._to_idle()
	if hero.get("trail") != null:
		hero.trail.emitting = false
	if hero.get("weapon") != null:
		hero.weapon.reset()
	hero.global_position = _mark
	hero.velocity = Vector3.ZERO
	hero.set("_vel", Vector3.ZERO)
	hero.move_input = Vector3.ZERO
	hero.face = -_face
	hero.model.rotation.y = atan2(-_face.x, -_face.z)


func _valid() -> bool:
	return is_instance_valid(game) and game.dungeon == _dungeon and game.state == "cutscene" and is_instance_valid(boss) \
		and game.player != null and is_instance_valid(game.player)


func _once(key: String) -> bool:
	if _did.has(key):
		return false
	_did[key] = true
	return true


func _process(delta: float) -> void:
	if _done:
		return
	if not _valid():
		_abort()
		return
	var rd := minf(delta / maxf(Engine.time_scale, 0.05), 0.1)
	t += rd
	_shot_frames += 1
	# 영웅은 제자리에서 기다린다(직접 이동을 비우고, 자동 이동이 다시 시작되지 않게 붙잡는다)
	var hero: Node3D = game.player
	hero.move_input = Vector3.ZERO
	hero.manual_t = 0.0
	_beats()
	if _done:
		return
	_boss_pose()
	_camera(rd)
	_overlay()


## 시각표대로 한 번씩 일어나는 일
func _beats() -> void:
	if _once("A"):
		_cut("A")
		comic.bars_in(-0.6)
	if t >= 0.35 and _once("caption"):
		comic.caption(CAPTION)
	if t >= _at.B - 0.2 and _once("caption_out"):
		comic.caption("")
	if t >= _at.B and _once("B"):
		_cut("B")
		comic.open(0.7)
	if t >= _at.B + SAY_SEATED and _once("say_seated"):
		comic.say("boss", LINE_SEATED, "talk", _hud(_boss_head()))
	if t >= _at.rise - 0.1 and _once("hush_seated"):
		comic.hush("boss")
	if t >= _at.rise and _once("rise"):
		_rise()
	if t >= _at.hit and _once("hit"):
		_thud()
	if t >= _at.C and _once("C"):
		_cut("C")
		_close = boss.head_pos()
		comic.open(-1.0)
		comic.focus(true, true)
	# 클로즈업이 두 프레임 그려진 뒤에 멈춘다(멈춘 화면이 앞 장면이 되지 않게)
	if _shot == "C" and _shot_frames >= 3 and _once("impact"):
		comic.impact(IMPACT)
		comic.sfx("두둥!", Vector2(comic.size.x * 0.72, comic.size.y * 0.24), -0.14, Comic.BLOOD, SHOT_C - 0.1)
		game.hitstop(IMPACT)
		game.sfx("heavy", 0.0, 2.0)
		game.sfx("glint", 0.0, -2.0)
		game.vibrate(50)
	if _did.has("impact") and t >= _at.C + IMPACT + 0.1 and _once("focus_light"):
		comic.focus(true, false)
	if t >= _at.C + IMPACT + 0.12 and _once("say_glare"):
		comic.say("boss", LINE_GLARE, "cold", _hud(_boss_head()), Color(0, 0, 0, 0), Vector2(0.3, 0.8))
	if t >= _at.D - 0.1 and _once("hush_glare"):
		comic.hush("boss")
		comic.focus(false)
		comic.eye_off()
	if t >= _at.D and _once("D"):
		_cut("D")
		comic.open(0.45)
	if t >= _at.D + 0.12 and _once("say_hero"):
		var h: Dictionary = game.party[game.active]
		comic.say("hero", REPLY.get(h.name, "여기서 끝낸다!"), "shout", _hud(_hero_head()), h.color)
	if t >= _at.title - 0.1 and _once("hush_hero"):
		comic.hush("hero")
	if t >= _at.title and _once("title"):
		comic.title(BOSS.kicker, BOSS.name, BOSS.sub)
		comic.flash(Comic.PAPER, 0.12)
		game.sfx("heavy", 0.0, 0.0)
		game.vibrate(40)
		_handoff()
	if t >= _at.end - 0.32 and _once("title_out"):
		comic.title_out()
		comic.bars_out()
	if t >= _at.end and _once("end"):
		finish()


func _cut(shot: String) -> void:
	_shot = shot
	_shot_t = t
	_shot_frames = 0
	_look = Vector3.INF


## 보스가 일어선다. 일어서며 영웅을 노려본다
func _rise() -> void:
	if _slam:
		boss._play(SLAM.clip, SLAM.speed, 0.3, true)
		boss.anim.seek(SLAM.from, true)
	else:
		boss._play("throne_rise", 1.0, 0.2, true)


## 무기가 바닥을 찍었다: 흔들림, 묵직한 소리, 흙먼지, 효과음 글자
func _thud() -> void:
	_shake = 0.2
	game.sfx("heavy", 0.0, 3.0)
	game.sfx("counter", 0.05, -4.0)
	game.vibrate(80)
	var at := _stand + _face * 1.3
	at.y = game.height_at(at.x, at.z)
	Vfx.shock(game, at, _face, 1.4)
	Vfx.dust(game, at, _face)
	if game.dungeon.has_method("enter_room"):
		game.dungeon.enter_room(room)   # 보스 방 화로가 확 타오른다(싸움이 시작될 때 한 번 더)
	var p := _hud(at)
	if p == Vector2.INF:
		p = comic.size * Vector2(0.5, 0.7)
	comic.sfx("쿵!", p + Vector2(-150.0 if p.x > comic.size.x * 0.5 else 150.0, -40.0), -0.1, Comic.PAPER, AFTER_HIT + 0.05)


## 보스 자세: 웅크림을 펴고, 일어서는 동작이 끝나면 전투 대기로, 일어선 뒤로는 영웅을 노려본다
func _boss_pose() -> void:
	if t < _at.rise:
		return
	var p: Variant = boss.proc
	if _slam:
		p.crouch = SEAT_DROP * (1.0 - smoothstep(0.0, 1.0, (t - _at.rise) / RISE_UP))
	# 일어서며 옥좌 앞으로 나선다(발은 절차적 걸음이 따라 딛는다)
	var k := smoothstep(0.0, 1.0, (t - _at.rise) / STEP_OUT)
	boss.global_position = _sit.lerp(_stand, k)
	var cur: String = boss._current
	if cur != "idle" and (not boss.anim.is_playing() or (_slam and t >= _at.C - 0.25)):
		boss._play("idle", 1.0, 0.35, true)
	var hero: Node3D = game.player
	p.gaze(hero.head_pos())
	p.look(hero.global_position)


## 장면별 카메라. 위치와 보는 점을 장면 진행(0~1)으로 옮기고, 흔들림을 얹는다
func _camera(rd: float) -> void:
	if not camera_on:
		return
	var cam: Camera3D = game.camera
	var up := Vector3.UP
	var pos := Vector3.ZERO
	var want := Vector3.ZERO
	var fov := 44.0
	match _shot:
		"A":
			# 융단 끝 영웅의 등 뒤 머리 위에서 융단을 따라 옥좌 앞 낮은 곳까지 내려앉으며 미끄러진다(천천히 출발해 천천히 선다).
			# 세로 화면은 가로 화각이 좁아(약 22°) 영웅을 화면 아래에 두려면 거의 바로 뒤에서 내려다봐야 한다
			var k := smoothstep(0.0, 1.0, (t - _shot_t) / SHOT_A)
			var p0 := _mark + _face * 2.2 + _side * 0.25 + up * 2.5
			var p1 := _seat + _face * 5.4 + _side * 0.45 + up * 0.95
			pos = p0.lerp(p1, k)
			want = (_seat + up * 1.5).lerp(_seat + up * 1.9, k)
			fov = lerpf(46.0, 40.0, k)
			_light(_stand + _face * 1.8 + up * 1.4, 3.0, 0.0, Color(1.0, 0.72, 0.5))
		"B":
			# 앉은 보스를 낮은 각도에서 올려다보며 조금씩 다가간다. 일어서면 머리를 따라 올려다본다
			var k := clampf((t - _shot_t) / maxf(_at.C - _at.B, 0.1), 0.0, 1.0)
			pos = (_seat + _face * 4.3 + _side * 1.55 + up * 0.85).lerp(_seat + _face * 3.6 + _side * 1.2 + up * 0.8, 1.0 - pow(1.0 - k, 2.0))
			want = _boss_head() + up * 0.05
			fov = 46.0
			_light(boss.global_position + _face * 1.4 + _side * 0.7 + up * 1.5, 3.0, 0.6, Color(1.0, 0.72, 0.5))
		"C":
			# 노려보는 얼굴: 영웅과 보스 머리 사이에서 얼굴을 꽉 채운다(조금씩 다가선다)
			var k := clampf((t - _shot_t) / SHOT_C, 0.0, 1.0)
			var to_hero: Vector3 = _hero_head() - _close
			to_hero.y *= 0.3
			to_hero = to_hero.normalized()
			# 앞머리 밑의 눈이 보이게 눈높이보다 조금 낮은 데서 올려다보고, 아래에서 붉은빛을 쳐 올린다
			pos = _close + to_hero * lerpf(1.7, 1.35, k) + _side * 0.12 + up * 0.02
			want = boss.head_pos() + up * 0.14
			fov = 30.0
			_light(_close + to_hero * 0.9 + _side * 0.3 - up * 0.35, 1.8, 0.7, Color(1.0, 0.45, 0.4))
		"D":
			# 대답하는 영웅을 앞에서 조금 낮게(보스 쪽에서) 잡는다
			var k := clampf((t - _shot_t) / SHOT_D, 0.0, 1.0)
			var hh := _hero_head()
			var to_boss: Vector3 = _seat - _mark
			to_boss.y = 0.0
			to_boss = to_boss.normalized()
			pos = hh + to_boss * lerpf(3.5, 3.15, k) + _side * 1.0 - up * 0.35
			want = hh - up * 0.1
			fov = 38.0
			_light(hh + to_boss * 1.3 + _side * 0.5 - up * 0.2, 2.6, 1.4, Color(1.0, 0.82, 0.62))
	# 보는 점은 머리를 부드럽게 따라간다(장면이 바뀌면 바로 잡는다)
	_look = want if _look == Vector3.INF else _look.lerp(want, 1.0 - exp(-rd * 7.0))
	pos.y = maxf(pos.y, game.height_at(pos.x, pos.z) + 0.4)
	# 흔들림: 화면 좌우·위아래로 빠르게 떨며 줄어든다
	_shake *= exp(-rd * 6.0)
	var basis := cam.global_transform.basis
	var j: Vector3 = (basis.x * sin(t * 71.0) + basis.y * cos(t * 53.0) * 0.8) * _shake
	cam.fov = fov
	cam.global_position = pos + j
	cam.look_at(_look + j * 0.5, Vector3.UP)


## 연출 조명을 옮긴다(툰 셰이더는 범위 안의 몸 전체를 밝히므로 범위를 좁게 잡는다)
func _light(at: Vector3, reach: float, energy: float, color: Color) -> void:
	_key.global_position = at
	_key.omni_range = reach
	_key.light_energy = energy
	_key.light_color = color


## 말풍선 꼬리·집중선이 머리를 따라가게 한다
func _overlay() -> void:
	comic.point("boss", _hud(boss.head_pos() if _shot == "C" else _boss_head()))   # 클로즈업에서는 얼굴을 가리킨다
	comic.point("hero", _hud(_hero_head()))
	if _shot == "C":
		comic.focus_at(_hud(boss.head_pos() + Vector3(0, 0.14, 0)))
		# 그늘진 얼굴에서 빛나는 눈빛: 앞머리에 가리지 않은 왼눈(모델 +X)
		if _did.has("impact") and not _did.has("hush_glare"):
			comic.eye(_hud(boss.head_pos() + boss.model.global_transform.basis * EYE))
	comic.skip_ready = t >= SKIP_AFTER


## 보스 머리 위(말풍선 꼬리·카메라가 볼 점). head_pos는 절차적 보정 전 자세라 웅크린 만큼 내린다
func _boss_head() -> Vector3:
	return boss.head_pos() + Vector3(0, 0.3 - boss.proc.crouch * boss.proc.unit, 0)


func _hero_head() -> Vector3:
	return game.player.head_pos() + Vector3(0, 0.2, 0)


## 월드 좌표 → HUD 좌표(카메라 뒤면 INF)
func _hud(p: Vector3) -> Vector2:
	if game.camera.is_position_behind(p):
		return Vector2.INF
	return game.to_hud(p)


## 이름판이 덮는 순간 카메라를 게임으로 돌려준다(장면 전환이 이름판 뒤에 숨는다)
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
	# 연출 중에는 HUD(전투 조작)로 입력을 넘기지 않는다. 1초가 지나면 누르는 것으로 건너뛴다
	if event is InputEventScreenTouch or event is InputEventScreenDrag or event is InputEventKey or event is InputEventMouseButton:
		get_viewport().set_input_as_handled()
	var press: bool = (event is InputEventScreenTouch or event is InputEventMouseButton or (event is InputEventKey and not event.echo)) and event.pressed
	if press and t >= SKIP_AFTER:
		finish()


## 연출을 끝내고 싸움을 시작한다(건너뛸 때도 이리 온다). 보스를 일으켜 세우고 방의 적을 깨운다
func finish() -> void:
	if _done:
		return
	_done = true
	_handoff()
	if is_instance_valid(boss):
		boss.throne = false
		boss.proc.crouch = 0.0
		boss.global_position = _stand
		boss.proc.gaze(null)
		if boss._current != "idle":
			boss._play("idle", 1.0, 0.2, true)
	# 연출 상태인 채로 깨워야 방 알림이 뜨지 않는다(이름판을 이미 보여 줬다)
	if is_instance_valid(game) and game.dungeon == _dungeon:
		game._enter_room(room)
	_restore()


## 방을 새로 만들었거나(다시 하기) 영웅·보스가 사라졌다: 깨우지 않고 정리만 한다
func _abort() -> void:
	_done = true
	_restore()


func _restore() -> void:
	camera_on = false
	if is_instance_valid(_key):
		_key.queue_free()
	if comic != null:
		comic.cleanup()
	if is_instance_valid(game):
		game.camera.fov = _fov0
		game.music.volume_db = _music_db
		if game.state == "cutscene":
			game.state = "play"
		# 전투 UI를 천천히 다시 보인다
		var hud: Control = game.hud
		if hud != null:
			hud.modulate.a = 0.0
			var tw := hud.create_tween()
			tw.set_ignore_time_scale(true)
			tw.tween_property(hud, "modulate:a", 1.0, 0.45)
	queue_free()
